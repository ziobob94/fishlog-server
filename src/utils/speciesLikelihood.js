// «Pesci più probabili»: stima indicativa per specie da stagione, temperatura dell'acqua, condizioni del giorno e,
// se esiste, lo storico di catture dell'utente nel luogo. Regole in src/data/fishingRules.json (sezione `species`),
// profili in src/data/speciesProfiles.json. Non è validata con dati reali: vedi docs/fishing-activity.md.
// Oltre i 7 giorni (niente temperatura dell'acqua né condizioni orarie) conta solo la stagione.
import profilesFile from '../data/speciesProfiles.json' with { type: 'json' }
import { loadRules } from './fishingActivity.js'

const isNum = v => typeof v === 'number' && Number.isFinite(v)
const norm = s => String(s || '').trim().toLowerCase()

// 1 dentro l'intervallo ottimale, scende linearmente a 0 a 8 °C di distanza.
export function tempFit(t, [lo, hi]) {
  if (!isNum(t)) return null
  if (t >= lo && t <= hi) return 1
  const d = t < lo ? lo - t : t - hi
  return Math.max(0, 1 - d / 8)
}
// Quanto le condizioni del giorno si adattano alle preferenze della specie (0..1 oppure null senza attività).
export function conditionsFit(profile, activity) {
  if (!activity?.factors) return null
  const f = activity.factors, fs = k => f[k]?.score
  const parts = []
  if (isNum(fs('wind'))) parts.push(fs('wind'))
  if (profile.tide > 0 && isNum(fs('tide'))) parts.push(fs('tide') * profile.tide + (1 - profile.tide))
  if (isNum(fs('light'))) parts.push(fs('light'))
  return parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null
}

/**
 * @param {object} p
 *  - month: 1..12 · water: 'mare' | 'dolce' · waterTemp: °C o null · activity: risultato di activityForDay o null
 *  - userCounts: Map nome minuscolo → catture dell'utente nel luogo
 * @returns {{ basis: 'condizioni'|'stagione', items: Array }}
 */
export function likelySpecies({ month, water = 'mare', waterTemp = null, activity = null, userCounts = new Map(), rulesOverride } = {}) {
  const R = loadRules(rulesOverride).species
  const detailed = isNum(waterTemp) || !!activity
  const items = []
  for (const p of profilesFile.profiles) {
    if (water === 'mare' ? p.water !== 'mare' : p.water === 'mare') continue
    const season = p.season[(month - 1 + 12) % 12]
    const temp = detailed ? tempFit(waterTemp, p.waterTemp) : null
    const cond = detailed ? conditionsFit(p, activity) : null
    const parts = [[season, R.weights.season], [temp, R.weights.waterTemp], [cond, R.weights.conditions]].filter(([v]) => isNum(v))
    const wsum = parts.reduce((a, [, w]) => a + w, 0)
    let score = parts.reduce((a, [v, w]) => a + v * w, 0) / wsum
    const own = [p.name, ...(p.aliases || [])].reduce((a, n) => a + (userCounts.get(norm(n)) || 0), 0)
    if (own > 0) score += Math.min(R.userHistory.maxBonus, own * R.userHistory.bonusPerCatch)
    score = Math.min(1, score)
    if (score < R.minScore) continue
    const lv = R.levels.find(l => score <= l.max) || R.levels[R.levels.length - 1]
    items.push({
      name: p.name, score: Number(score.toFixed(2)), level: lv.key, label: lv.label, dots: lv.dots,
      reason: reasonOf(p, { season, temp, cond, waterTemp, detailed, own }),
      userCatches: own > 0 ? own : null,
    })
  }
  items.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  return { basis: detailed ? 'condizioni' : 'stagione', items: items.slice(0, R.maxItems) }
}

function reasonOf(p, { season, temp, waterTemp, detailed, own }) {
  const bits = []
  bits.push(season >= 0.8 ? 'è nel suo periodo migliore' : season >= 0.5 ? 'è una stagione discreta' : 'è fuori dalla stagione migliore')
  if (detailed && isNum(temp)) bits.push(temp >= 0.99 ? `l'acqua (${Math.round(waterTemp)} °C) gli è congeniale` : `l'acqua (${Math.round(waterTemp)} °C) è meno adatta`)
  if (own > 0) bits.push(own === 1 ? 'ne hai già preso uno qui' : `ne hai già prese ${own} qui`)
  const s = bits.join(', ')
  return s.charAt(0).toUpperCase() + s.slice(1) + '.'
}

// ── «In stagione»: specie più comuni del mese per la zona ───────────────────────────────────────
// Solo stagione (nessuna temperatura né condizioni del giorno): è l'elenco della schermata Specie.
// Zona = macro-area dedotta dalla latitudine; senza posizione vale tutta Italia. Oggi la curva è la stessa per tutte
// le zone (vedi `seasonByZone` in speciesProfiles.json): dato indicativo, da validare.
export function zoneOf(lat) {
  if (!isNum(lat)) return 'italia'
  return lat >= 44 ? 'nord' : lat >= 41.5 ? 'centro' : 'sud'
}

export function seasonalSpecies({ month, zone = 'italia', userCounts = new Map(), limit, rulesOverride } = {}) {
  const R = loadRules(rulesOverride).species
  const items = []
  for (const p of profilesFile.profiles) {
    const curve = p.seasonByZone?.[zone] || p.season
    const score = curve[(month - 1 + 12) % 12]
    if (score < R.minScore) continue
    const lv = R.levels.find(l => score <= l.max) || R.levels[R.levels.length - 1]
    const own = [p.name, ...(p.aliases || [])].reduce((a, n) => a + (userCounts.get(norm(n)) || 0), 0)
    items.push({
      name: p.name, scientificName: p.scientificName || null, water: p.water,
      score, level: lv.key, label: lv.label, dots: lv.dots,
      season: curve, userCatches: own > 0 ? own : null,
    })
  }
  const rank = i => R.levels.findIndex(l => l.key === i.level)
  items.sort((a, b) => rank(b) - rank(a) || (b.userCatches || 0) - (a.userCatches || 0) || a.name.localeCompare(b.name, 'it'))
  return items.slice(0, limit ?? R.maxItems)
}
