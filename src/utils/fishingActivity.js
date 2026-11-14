// Attività dei pesci: STIMA INDICATIVA ora per ora, costruita da regole dichiarate e configurabili
// (src/data/fishingRules.json, sovrascrivibili con la chiave `fishing.rules` della config). Non è una previsione
// e le regole NON sono ancora validate con dati reali: vedi docs/fishing-activity.md (sezione «Come validarle»).
// Funzioni pure: nessun accesso a rete o database, così sono testabili.
import defaultRules from '../data/fishingRules.json' with { type: 'json' }

const isNum = v => typeof v === 'number' && Number.isFinite(v)
const clamp01 = v => Math.min(1, Math.max(0, v))
const mean = a => a.reduce((x, y) => x + y, 0) / a.length

// Merge profondo: gli array e i valori scalari dell'override sostituiscono quelli di default.
export function mergeRules(base, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) return base
  const out = { ...base }
  for (const [k, v] of Object.entries(override)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) ? mergeRules(base[k], v) : v
  }
  return out
}
export const loadRules = override => mergeRules(defaultRules, override)

export function levelOf(score, rules = defaultRules) {
  if (!isNum(score)) return null
  const l = rules.levels.find(x => score <= x.max) || rules.levels[rules.levels.length - 1]
  return { level: l.level, label: l.label }
}
export const verdictOf = (score, rules = defaultRules) => (!isNum(score) ? null : score >= rules.verdict.favorable ? 'favorevole' : score <= rules.verdict.unfavorable ? 'sfavorevole' : 'neutro')

// Affidabilità della previsione per giorno (0 = oggi): alta fino al 3º giorno, media fino al 7º, bassa oltre.
export const reliabilityOf = dayIndex => (dayIndex <= 2 ? 'alta' : dayIndex <= 6 ? 'media' : 'bassa')

const minutesOf = iso => { const m = typeof iso === 'string' && iso.match(/T(\d{2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null }

// ── Fattori (ognuno restituisce 0..1 oppure null se il dato manca) ────────────
export function lightScore(hour, sunrise, sunset, moonIllumination, rules = defaultRules) {
  const r = minutesOf(sunrise), s = minutesOf(sunset)
  if (!isNum(hour) || r == null || s == null) return null
  const L = rules.light, mid = hour * 60 + 30
  const dist = Math.min(Math.abs(mid - r), Math.abs(mid - s))
  const isDay = mid > r && mid < s
  const base = isDay ? L.day : L.night + (isNum(moonIllumination) && !isDay ? L.nightMoonBonus * moonIllumination : 0)
  if (dist >= L.dawnDuskWindowMin) return clamp01(base)
  return clamp01(L.peak - (L.peak - base) * (dist / L.dawnDuskWindowMin))
}
// Movimento della marea: velocità di variazione del livello (m/h) rispetto alla massima del giorno.
export function tideScores(heights, rules = defaultRules) {
  const h = heights.map(v => (isNum(v) ? v : null))
  const valid = h.filter(isNum)
  if (valid.length < 6 || Math.max(...valid) - Math.min(...valid) < 0.05) return h.map(() => null) // marea trascurabile: fattore non usato
  const rate = h.map((_, i) => (isNum(h[i - 1]) && isNum(h[i + 1]) ? Math.abs(h[i + 1] - h[i - 1]) / 2 : null))
  const max = Math.max(...rate.filter(isNum))
  if (!(max > 0)) return h.map(() => null)
  const T = rules.tide
  return rate.map(r => (r == null ? null : r / max < T.slackBelow ? T.slackScore : T.minScore + (1 - T.minScore) * (r / max)))
}
// delta = variazione della pressione (hPa) nelle 3 ore precedenti.
export function pressureScore(delta, rules = defaultRules) {
  if (!isNum(delta)) return null
  const P = rules.pressure
  if (Math.abs(delta) <= P.stableBand * 0.5) return P.stable.score
  if (delta < 0) return delta >= P.fallingSlow.from ? P.fallingSlow.score : P.fallingFast.score
  return delta <= P.risingSlow.to ? P.risingSlow.score : P.risingFast.score
}
export function windScore(kmh, rules = defaultRules) {
  if (!isNum(kmh)) return null
  const W = rules.wind
  if (kmh <= W.idealMaxKmh) return 1
  if (kmh >= W.badKmh) return W.floor
  return 1 - (1 - W.floor) * ((kmh - W.idealMaxKmh) / (W.badKmh - W.idealMaxKmh))
}
export function waterTempScore(t, rules = defaultRules) {
  if (!isNum(t)) return null
  const W = rules.waterTemp
  if (t >= W.optimalMin && t <= W.optimalMax) return 1
  if (t <= W.min || t >= W.max) return W.floor
  return t < W.optimalMin ? W.floor + (1 - W.floor) * ((t - W.min) / (W.optimalMin - W.min)) : W.floor + (1 - W.floor) * ((W.max - t) / (W.max - W.optimalMax))
}

// Combina i fattori disponibili con i pesi rinormalizzati; con meno di `minFactors` fattori non dà nessuna stima.
export function combine(factors, rules = defaultRules) {
  const used = Object.entries(factors).filter(([, v]) => isNum(v))
  if (used.length < rules.minFactors) return null
  const wsum = used.reduce((a, [k]) => a + (rules.weights[k] ?? 0), 0)
  if (!(wsum > 0)) return null
  return clamp01(used.reduce((a, [k, v]) => a + v * (rules.weights[k] ?? 0), 0) / wsum)
}

/**
 * Attività di un giorno.
 * @param {object} p
 *  - date: 'YYYY-MM-DD'
 *  - hourly: tutte le ore del pannello (per la tendenza della pressione servono le 3 ore precedenti)
 *  - marineHours: [{time, seaTemp}] (ora locale 'YYYY-MM-DDTHH:00') — opzionale
 *  - tideSeries: [{time, height}] — opzionale
 *  - sunrise, sunset: ISO locali; moonIllumination: 0..1
 *  - withHourFactors: true → ogni ora porta anche `f` (i punteggi dei fattori di quell'ora), usato dal riassunto «adesso»
 * @returns null se non ci sono abbastanza dati, altrimenti { score, level, label, hours, windows, factors }
 */
export function activityForDay({ date, hourly = [], marineHours = [], tideSeries = [], sunrise, sunset, moonIllumination = null, withHourFactors = false }, rules = defaultRules) {
  const idx = hourly.map((h, i) => (h.date === date ? i : -1)).filter(i => i >= 0)
  if (idx.length < 6) return null
  const key = h => `${date}T${String(h).padStart(2, '0')}:00`
  const seaTemp = new Map(marineHours.map(m => [String(m.time).slice(0, 13), m.seaTemp]))
  const tideByHour = new Map(tideSeries.map(t => [String(t.time).slice(0, 13), t.height]))
  const tides = tideScores(Array.from({ length: 24 }, (_, h) => tideByHour.get(key(h).slice(0, 13)) ?? null), rules)
  const hours = []
  const sums = { light: [], tide: [], pressure: [], wind: [], waterTemp: [] }
  for (const i of idx) {
    const row = hourly[i], hr = row.hour
    if (!isNum(hr)) continue
    const prev = hourly[i - 3]
    const delta = isNum(row.pressure) && isNum(prev?.pressure) ? row.pressure - prev.pressure : null
    const f = {
      light: lightScore(hr, sunrise, sunset, moonIllumination, rules),
      tide: tides[hr] ?? null,
      pressure: pressureScore(delta, rules),
      wind: windScore(row.windSpeed, rules),
      waterTemp: waterTempScore(seaTemp.get(key(hr).slice(0, 13)) ?? null, rules),
    }
    for (const k of Object.keys(sums)) if (isNum(f[k])) sums[k].push(f[k])
    const score = combine(f, rules)
    hours.push({ hour: hr, score: score == null ? null : Number(score.toFixed(2)), level: levelOf(score, rules)?.level ?? null, ...(withHourFactors ? { f } : {}) })
  }
  const scored = hours.filter(h => h.score != null)
  if (scored.length < 6) return null
  // Punteggio del giorno: media delle 6 ore migliori (si pesca per poche ore, non tutto il giorno).
  const top = [...scored].sort((a, b) => b.score - a.score).slice(0, 6)
  const score = mean(top.map(h => h.score))
  const lv = levelOf(score, rules)
  const factors = {}
  for (const [k, a] of Object.entries(sums)) factors[k] = a.length ? { score: Number(mean(a).toFixed(2)), verdict: verdictOf(mean(a), rules) } : null
  return { score: Number(score.toFixed(2)), level: lv.level, label: lv.label, hours, windows: windowsOf(scored), factors, partial: idx.length < 24 }
}

// Finestre più favorevoli: ore consecutive con punteggio vicino al massimo del giorno e almeno «media-buona» (0,6). Al massimo 2.
export function windowsOf(scored) {
  if (!scored.length) return []
  const max = Math.max(...scored.map(h => h.score))
  const thr = Math.max(0.6, max - 0.08)
  const ok = scored.filter(h => h.score >= thr).map(h => h.hour).sort((a, b) => a - b)
  const wins = []
  for (const h of ok) {
    const w = wins[wins.length - 1]
    if (w && h === w.to) w.to = h + 1; else wins.push({ from: h, to: h + 1 })
  }
  return wins
    .map(w => ({ ...w, best: Math.max(...scored.filter(h => h.hour >= w.from && h.hour < w.to).map(h => h.score)) }))
    .sort((a, b) => b.best - a.best).slice(0, 2).sort((a, b) => a.from - b.from)
    .map(w => ({ from: `${String(w.from).padStart(2, '0')}:00`, to: `${String(w.to % 24).padStart(2, '0')}:00` }))
}

// Frase breve per ogni fattore. Sempre prudente: «spesso», mai promesse.
export function factorText(key, verdict, ctx = {}) {
  const f = ctx
  switch (key) {
    case 'light': return verdict === 'favorevole' ? 'Alba o tramonto nelle ore utili: spesso i pesci si muovono di più.' : verdict === 'sfavorevole' ? 'Poca luce utile nelle ore disponibili.' : 'Luce nella media.'
    case 'tide': return verdict === 'favorevole' ? 'La marea si muove bene: spesso aiuta la ricerca del cibo.' : verdict === 'sfavorevole' ? 'Marea quasi ferma per gran parte del giorno.' : 'Marea con movimento moderato.'
    case 'pressure': return verdict === 'favorevole' ? 'Pressione in lieve calo: spesso accompagna una maggiore attività (uno spunto, non una previsione).' : verdict === 'sfavorevole' ? 'Pressione in variazione rapida: spesso i pesci sono più prudenti.' : 'Pressione stabile.'
    case 'wind': return verdict === 'favorevole' ? `Vento debole${isNum(f.windMax) ? ` (fino a ${Math.round(f.windMax)} km/h)` : ''}.` : verdict === 'sfavorevole' ? `Vento forte${isNum(f.windMax) ? ` (fino a ${Math.round(f.windMax)} km/h)` : ''}: pesca più difficile.` : 'Vento moderato.'
    case 'waterTemp': return verdict === 'favorevole' ? `Acqua${isNum(f.waterTemp) ? ` a ${Math.round(f.waterTemp)} °C` : ''}, nella fascia che molte specie gradiscono.` : verdict === 'sfavorevole' ? `Acqua${isNum(f.waterTemp) ? ` a ${Math.round(f.waterTemp)} °C` : ''}, fuori dalla fascia più comoda per molte specie.` : 'Temperatura dell\'acqua accettabile.'
    default: return ''
  }
}
