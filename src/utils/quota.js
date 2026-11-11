// Contatore mensile di richieste a un servizio a quota (oggi: Google Weather, 10.000 gratuite al mese).
// - Il conteggio vive su MongoDB (RuntimeConfig, chiave `usage.<id>`) con incremento atomico: giusto anche con più
//   processi (PM2 cluster) e dopo un riavvio; si azzera da solo al cambio di mese. Senza database resta in memoria.
// - Avvisi a soglie percentuali (default 70% e 90%): una sola volta a soglia e mese, nei log e per email agli admin.
// - Blocco prima del limite (default 95%): `reserve()` rifiuta la chiamata PRIMA di farla, quindi la quota non viene mai superata.
// Soglie configurabili da admin (Configurazione → Google Weather) o da env.
import mongoose from 'mongoose'
import RuntimeConfig from '../models/RuntimeConfig.js'
import User from '../models/User.js'
import AppConfig from '../config.js'
import { sendMail } from './mailer.js'

const config = new AppConfig()
const monthNow = () => new Date().toISOString().slice(0, 7)
const dbUp = () => mongoose.connection.readyState === 1

export function parsePcts(v, fallback = [70, 90]) {
  const list = String(v ?? '').split(/[\s,;]+/).map(Number).filter(n => Number.isFinite(n) && n > 0 && n < 100)
  return (list.length ? list : fallback).sort((a, b) => a - b)
}

export function createQuota({ id, label, envPrefix, cfgPrefix, defaultQuota = 10000, send = sendMail }) {
  const KEY = `usage.${id}`
  const mem = { month: '', count: 0, alerts: [] }
  let blocked = false
  let lastSync = 0

  const num = (env, key, def) => Number(process.env[`${envPrefix}_${env}`] ?? config.get(`${cfgPrefix}.${key}`, def)) || def
  const settings = () => {
    const quota = num('MONTHLY_QUOTA', 'weatherMonthlyQuota', defaultQuota)
    const warn = parsePcts(process.env[`${envPrefix}_ALERT_PCTS`] ?? config.get(`${cfgPrefix}.weatherAlertPcts`, '70,90'))
    const stopPct = Math.min(99, Math.max(1, num('STOP_PCT', 'weatherStopPct', 95)))
    return { quota, warn, stopPct, stopAt: Math.floor(quota * stopPct / 100) }
  }

  // Incrementa atomicamente e restituisce { month, count, alerts }.
  async function bump(delta) {
    const m = monthNow()
    if (!dbUp()) {
      if (mem.month !== m) { mem.month = m; mem.count = 0; mem.alerts = [] }
      mem.count += delta
      return { month: m, count: mem.count, alerts: mem.alerts }
    }
    const inc = { $inc: { 'value.count': delta } }
    let doc = await RuntimeConfig.findOneAndUpdate({ key: KEY, 'value.month': m }, inc, { new: true }).lean()
    if (!doc) { // primo uso o nuovo mese: riparte da zero
      try {
        doc = await RuntimeConfig.findOneAndUpdate({ key: KEY }, { $set: { value: { month: m, count: Math.max(delta, 0), alerts: [] } } }, { upsert: true, new: true }).lean()
      } catch { doc = await RuntimeConfig.findOneAndUpdate({ key: KEY, 'value.month': m }, inc, { new: true }).lean() }
    }
    return { month: m, ...(doc?.value || { count: 0, alerts: [] }) }
  }

  async function admins() {
    if (!dbUp()) return []
    try { return (await User.find({ role: 'admin' }).select('email').lean()).map(u => u.email).filter(Boolean) } catch { return [] }
  }

  // Segna la soglia come già avvisata (atomico: un solo processo la vince) e manda log + email.
  async function alertOnce(level, st, count) {
    const m = monthNow()
    let won = true
    if (dbUp()) {
      won = !!(await RuntimeConfig.findOneAndUpdate({ key: KEY, 'value.month': m, 'value.alerts': { $ne: level } }, { $push: { 'value.alerts': level } }, { new: true }).lean())
    } else if (mem.alerts.includes(level)) won = false
    else mem.alerts.push(level)
    if (!won) return
    const pct = level === 'stop' ? st.stopPct : level
    const stop = level === 'stop'
    const msg = stop
      ? `${label}: raggiunto il ${pct}% della quota mensile (${count}/${st.quota}). Le chiamate sono BLOCCATE fino al prossimo mese: restano cache e ripiego Open-Meteo.`
      : `${label}: usato il ${pct}% della quota mensile (${count}/${st.quota}). Al ${st.stopPct}% le chiamate verranno bloccate.`
    console.warn(`[quota] ${msg}`)
    const to = await admins()
    if (to.length) send({ to: to.join(','), subject: `[Fishlog] ${stop ? 'Quota bloccata' : 'Avviso quota'}: ${label} al ${pct}%`, html: `<p>${msg}</p><p>Controlla il consumo in Admin → Meteo e quota, oppure alza la quota/soglie in Configurazione.</p>` }).catch(e => console.warn('[quota] email non inviata:', e?.message))
  }

  // Da chiamare PRIMA di ogni richiesta al servizio: se il blocco è attivo lancia 429 senza contare la chiamata.
  const FRESH = 60e3
  async function reserve() {
    const st = settings()
    if (blocked && Date.now() - lastSync < FRESH) { const e = new Error(`${label}: quota mensile quasi esaurita, chiamate bloccate`); e.status = 429; e.quotaBlocked = true; throw e }
    const { count, alerts } = await bump(1)
    if (count > st.stopAt) { // oltre il limite: annulla la prenotazione e blocca
      await bump(-1).catch(() => {})
      blocked = true; lastSync = Date.now()
      if (!alerts.includes('stop')) await alertOnce('stop', st, st.stopAt)
      const e = new Error(`${label}: quota mensile quasi esaurita, chiamate bloccate`); e.status = 429; e.quotaBlocked = true; throw e
    }
    blocked = false; lastSync = Date.now()
    for (const p of st.warn) if (count >= Math.floor(st.quota * p / 100) && !alerts.includes(p)) await alertOnce(p, st, count)
    if (count === st.stopAt) { blocked = true; await alertOnce('stop', st, count) } // l'ultima chiamata consentita è questa
    return count
  }

  // Stato corrente (admin, risposta dell'API). `blocked` anche senza chiamate se il contatore è già oltre il limite.
  async function status() {
    const st = settings(), m = monthNow()
    let v = mem
    if (dbUp()) { try { v = (await RuntimeConfig.findOne({ key: KEY }).lean())?.value || { month: '', count: 0, alerts: [] } } catch { /* usa la memoria */ } }
    const count = v.month === m ? v.count || 0 : 0
    blocked = count >= st.stopAt
    lastSync = Date.now()
    return { id, label, month: m, count, quota: st.quota, percent: Number(((count / st.quota) * 100).toFixed(1)), warnAt: st.warn, stopPct: st.stopPct, stopAt: st.stopAt, blocked, alerts: v.month === m ? v.alerts || [] : [], remaining: Math.max(0, st.stopAt - count) }
  }
  // Blocco noto senza accedere al database (si aggiorna a ogni reserve()/status()).
  // Se il blocco è attivo ma non verificato da più di un minuto, lo riverifica in background (nuovo mese o quota alzata).
  const isBlocked = () => {
    if (blocked && Date.now() - lastSync >= FRESH) status().catch(() => {})
    return blocked
  }
  const syncedAt = () => lastSync
  return { reserve, status, isBlocked, syncedAt, settings }
}
