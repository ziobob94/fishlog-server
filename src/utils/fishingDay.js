// Collega il pannello meteo (getOverview) alle regole dell'attività dei pesci.
import AppConfig from '../config.js'
import mongoose from 'mongoose'
import Session from '../models/Session.js'
import { activityForDay, loadRules, factorText, reliabilityOf, levelOf, verdictOf } from './fishingActivity.js'
import { likelySpecies } from './speciesLikelihood.js'

const config = new AppConfig()
export const rulesOverride = () => config.get('fishing.rules', null)
const ACTIVITY_DAYS = 7

export function inputsFor(view, i) {
  const d = view.daily[i]
  const marine = view.marine?.available ? view.marine : null
  return {
    date: d.date, hourly: view.activityHours || view.hourly, marineHours: marine?.waves || [], tideSeries: marine?.tides?.series?.map(s => ({ time: s.time, height: s.height })) || [],
    sunrise: d.sunrise ?? (i === 0 ? view.fishing?.sunrise : null), sunset: d.sunset ?? (i === 0 ? view.fishing?.sunset : null),
    moonIllumination: view.fishing?.moon?.illumination ?? null,
  }
}

// Riassunto per giorno (livello e punteggio) dentro la risposta del pannello, solo per i primi 7 giorni.
// Oltre: null (mancano ore, pressione e mare), il client mostra «—».
export function attachDailyActivity(view) {
  const rules = loadRules(rulesOverride())
  view.daily.forEach((d, i) => {
    let a = null
    if (i < ACTIVITY_DAYS) { try { a = activityForDay(inputsFor(view, i), rules) } catch { a = null } }
    d.activity = a ? { score: a.score, level: a.level, label: a.label } : null
  })
  return view
}

// Quante volte l'utente ha preso ogni specie entro il raggio dal luogo (testo libero → minuscolo).
export async function userSpeciesCounts(userId, lat, lng, radiusKm) {
  if (!userId || !mongoose.isValidObjectId(userId)) return new Map()
  const dLat = radiusKm / 111, dLng = radiusKm / (111 * Math.max(0.2, Math.cos(lat * Math.PI / 180)))
  const rows = await Session.aggregate([
    { $match: { userId: new mongoose.Types.ObjectId(userId), 'location.coords.lat': { $gte: lat - dLat, $lte: lat + dLat }, 'location.coords.lng': { $gte: lng - dLng, $lte: lng + dLng } } },
    { $unwind: '$catches' },
    { $group: { _id: { $toLower: { $trim: { input: '$catches.species' } } }, n: { $sum: 1 } } },
  ])
  return new Map(rows.map(r => [r._id, r.n]))
}

// Dettaglio di un giorno: attività oraria con finestre e «cosa pesa nella stima», più specie probabili.
export function fishingForDay(view, date, userCounts = new Map()) {
  const i = view.daily.findIndex(d => d.date === date)
  if (i < 0) return null
  const rules = loadRules(rulesOverride())
  const detailed = i < ACTIVITY_DAYS
  const activity = detailed ? activityForDay(inputsFor(view, i), rules) : null
  const marine = view.marine?.available ? view.marine : null
  const day = view.hourly.filter(h => h.date === date)
  const temps = (marine?.waves || []).filter(w => String(w.time).startsWith(date) && Number.isFinite(w.seaTemp)).map(w => w.seaTemp)
  const waterTemp = temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : null
  const windMax = day.length ? Math.max(...day.map(h => h.windSpeed).filter(Number.isFinite)) : null
  const ctx = { windMax: Number.isFinite(windMax) ? windMax : null, waterTemp }
  const factors = activity ? Object.entries(activity.factors).filter(([, f]) => f).map(([key, f]) => ({ key, verdict: f.verdict, score: f.score, text: factorText(key, f.verdict, ctx) })) : []
  const month = Number(date.slice(5, 7))
  const species = likelySpecies({ month, water: marine ? 'mare' : 'dolce', waterTemp: detailed ? waterTemp : null, activity, userCounts, rulesOverride: rulesOverride() })
  return {
    date, dayIndex: i, reliability: reliabilityOf(i), indicative: true, rulesVersion: rules.version,
    activity: activity ? { score: activity.score, level: activity.level, label: activity.label, hours: activity.hours, windows: activity.windows, partial: activity.partial, factors } : null,
    species,
  }
}
export { levelOf }

const EFFECT = { favorevole: 'up', neutro: 'flat', sfavorevole: 'down' }
const isNum = v => typeof v === 'number' && Number.isFinite(v)

// I fattori più influenti dell'ora: peso × distanza dal valore neutro (a parità, vince il peso maggiore). Ogni fattore ha un effetto: up | flat | down.
export function pickFactors(f, rules) {
  const max = rules.home?.maxFactors ?? 3, neutral = rules.home?.neutral ?? 0.5
  return Object.entries(f || {})
    .filter(([, v]) => isNum(v))
    .map(([key, v]) => ({ key, effect: EFFECT[verdictOf(v, rules)], w: rules.weights[key] ?? 0, infl: (rules.weights[key] ?? 0) * Math.abs(v - neutral) }))
    .sort((a, b) => b.infl - a.infl || b.w - a.w)
    .slice(0, max)
    .map(({ key, effect }) => ({ key, effect }))
}

// Prima finestra favorevole di oggi non ancora finita. `now: true` se l'ora corrente ci sta dentro.
export function nextWindow(windows, hour) {
  for (const w of windows || []) {
    const from = parseInt(w.from, 10), to = parseInt(w.to, 10) || 24
    if (to > hour) return { from: w.from, to: w.to, now: from <= hour }
  }
  return null
}

// Riassunto «adesso» per la Home e le schede delle località: { level 1-5, factors, nextWindow }.
// Senza dati sufficienti (meno di 2 fattori nell'ora) il livello è null: il client non inventa nulla. Lo storico delle uscite dell'utente non entra nel calcolo.
export function fishingNow(view, rules = loadRules(rulesOverride())) {
  const cur = view?.hourly?.[0]
  const i = cur ? view.daily.findIndex(d => d.date === cur.date) : -1
  const none = { level: null, factors: [], nextWindow: null, rulesVersion: rules.version }
  if (i < 0) return none
  let a = null
  try { a = activityForDay({ ...inputsFor(view, i), withHourFactors: true }, rules) } catch { a = null }
  const h = a?.hours.find(x => x.hour === cur.hour)
  if (!h || h.level == null) return none
  return { level: h.level, factors: pickFactors(h.f, rules), nextWindow: nextWindow(a.windows, cur.hour), rulesVersion: rules.version }
}
