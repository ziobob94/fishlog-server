// Orari dell'assistente. Gli orari delle uscite sono "ora del muro" (HH:MM) nel fuso dell'utente, Europe/Rome:
// il client manda la sua ora locale, il server non converte mai da/verso UTC. Qui si risolvono solo le ambiguità
// del parlato («alle 4:30» = 04:30 o 16:30?).
export const TZ = 'Europe/Rome'
const pad = n => String(n).padStart(2, '0')
const toMin = t => +t.slice(0, 2) * 60 + +t.slice(3)

// Data (mezzanotte UTC del giorno di calendario a Roma) e ora corrente a Roma, per quando il client non manda l'ora.
export function romeNow(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(now).map(x => [x.type, x.value]))
  return { date: new Date(`${p.year}-${p.month}-${p.day}T00:00:00.000Z`), time: `${p.hour}:${p.minute}` }
}

const FASCE = ['mattina', 'pomeriggio', 'sera', 'notte']

// heard: orario come detto («4:30», «04:30», «16:30», «5»). fascia: mattina|pomeriggio|sera|notte se detta.
// now: ora attuale HH:MM. Restituisce HH:MM a 24 ore, o undefined se non valido.
// Regole: ora 13–23 o 0 è già a 24 ore. Con fascia: mattina → am, pomeriggio/sera → pm, notte → 12→00, 1–5 am, 6–11 pm.
// Senza fascia, tra le due letture (h, h+12) si sceglie la più vicina non successiva a `now`: un orario passato
// non può essere nel futuro («alle 4:30» detto alle 15:16 = 04:30; detto alle 17:00 = 16:30).
export function resolveClock(heard, { fascia, now } = {}) {
  const m = String(heard ?? '').trim().match(/^(\d{1,2})(?:[:.h](\d{2}))?$/)
  if (!m) return undefined
  let h = +m[1]; const min = m[2] ? +m[2] : 0
  if (h > 23 || min > 59) return undefined
  if (h >= 13 || h === 0) return `${pad(h)}:${pad(min)}`
  const f = FASCE.includes(fascia) ? fascia : null
  if (f === 'mattina') h = h === 12 ? 12 : h
  else if (f === 'pomeriggio' || f === 'sera') h = h === 12 ? 12 : h + 12
  else if (f === 'notte') h = h === 12 ? 0 : (h <= 5 ? h : h + 12)
  else {
    const am = `${pad(h % 12)}:${pad(min)}`, pm = `${pad(h % 12 + 12)}:${pad(min)}`
    if (!/^\d\d:\d\d$/.test(String(now || ''))) return h === 12 ? pm : `${pad(h)}:${pad(min)}`
    const ok = [am, pm].filter(c => toMin(c) <= toMin(now))
    return ok.length ? ok.reduce((a, b) => (toMin(a) > toMin(b) ? a : b)) : am
  }
  return `${pad(h)}:${pad(min)}`
}
