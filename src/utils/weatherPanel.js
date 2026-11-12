// Pannello meteo + mare per una posizione qualsiasi (GET /api/weather/overview).
// In Italia la fonte principale è ICON-2I (via Open-Meteo, CC BY 4.0, ~2 km, 72 ore): poi Google per i giorni 4-10 e Open-Meteo oltre; fuori Italia o se ICON-2I non risponde, resta lo schema sotto.
// Meteo: Google Weather (attuale, 48 ore, 10 giorni) esteso con Open-Meteo (gratis) fino a 7 giorni di ore e 15 giorni di previsioni;
// ogni riga porta `source` ('google' | 'open-meteo'). Trend e storico della pressione vengono da Open-Meteo (pressione a livello del mare).
// Mare: Open-Meteo Marine (gratuito). Fuori dalla copertura marina (lago, entroterra) i campi sono null e `marine.available` è false.
// Fase lunare, illuminazione e trend pressione sono calcolati/derivati qui, così il client non ha logica.
import { cached, getJson, num, kmh, ymd, settle, ck, gCondition, omCondition, OM, OM_MARINE, cellOf, gCurrent, gDays, gHours, googleQuota, ICON2I_MODEL, ICON2I_HOURS, ICON2I_ATTRIBUTION, icon2iEnabled, inItaly } from './weather.js'
import { googleKey } from './weather.js'
import { attachDailyActivity } from './fishingDay.js'

const H = 3600e3
// Ore passate richieste a Open-Meteo: bastano a coprire dalla mezzanotte di oggi (max 23) e le 3 ore precedenti per la tendenza della pressione.
const PAST_HOURS = 24
// Somma e massimo che ignorano i valori mancanti; se manca tutto restituiscono null (mai 0).
const sumOf = (...vs) => { const n = vs.map(num).filter(v => v != null); return n.length ? n.reduce((a, b) => a + b, 0) : null }
const maxOf = (...vs) => { const n = vs.map(num).filter(v => v != null); return n.length ? Math.max(...n) : null }

// Codice WMO approssimato per i tipi di condizione Google (il client sceglie l'icona e il testo dal codice WMO).
// Tipo mancante o sconosciuto → null (il client mostra «nuvoloso» e «Non disponibile», mai un'icona vistosa).
export function googleTypeToWmo(type) {
  const t = String(type || '').toUpperCase()
  if (!t) return null
  if (/HAIL/.test(t)) return 96
  if (/THUNDER/.test(t)) return 95
  if (/SNOW|FLURR|SLEET|BLIZZARD/.test(t)) return 73
  if (/FOG|HAZE|MIST/.test(t)) return 45
  if (/HEAVY.*(RAIN|SHOWER)|(RAIN|SHOWER).*HEAVY|MODERATE_TO_HEAVY/.test(t)) return /SHOWER/.test(t) ? 82 : 65
  if (/SHOWER/.test(t)) return /LIGHT/.test(t) ? 80 : 81
  if (/DRIZZLE/.test(t)) return 51
  if (/LIGHT.*RAIN|RAIN.*LIGHT/.test(t)) return 61
  if (/RAIN/.test(t)) return 63
  if (t === 'CLEAR' || t === 'SUNNY') return 0
  if (t === 'MOSTLY_CLEAR' || t === 'MOSTLY_SUNNY') return 1
  if (t === 'PARTLY_CLOUDY') return 2
  if (t === 'MOSTLY_CLOUDY' || t === 'CLOUDY' || t === 'OVERCAST') return 3
  return null
}

// ── Luna (calcolo locale, precisione ±~1 giorno, più che sufficiente per la pesca) ─
const SYNODIC = 29.530588853
const NEW_MOON_REF = Date.UTC(2000, 0, 6, 18, 14) // luna nuova di riferimento
const MOON_NAMES = ['luna_nuova', 'luna_crescente', 'primo_quarto', 'gibbosa_crescente', 'luna_piena', 'gibbosa_calante', 'ultimo_quarto', 'luna_calante']
export function moonPhase(date = new Date()) {
  const age = (((date.getTime() - NEW_MOON_REF) / 86400e3) % SYNODIC + SYNODIC) % SYNODIC
  const frac = age / SYNODIC
  return {
    age: Number(age.toFixed(1)),
    illumination: Number(((1 - Math.cos(2 * Math.PI * frac)) / 2).toFixed(2)),
    phase: MOON_NAMES[Math.floor(((frac * 8) + 0.5)) % 8],
  }
}

// ── Trend pressione (hPa nelle ultime 3 h) ───────────────────────────────────
export function pressureTrend(deltaHpa3h) {
  if (deltaHpa3h == null) return null
  const d = deltaHpa3h
  const trend = d >= 3 ? 'in_forte_aumento' : d >= 1 ? 'in_aumento' : d <= -3 ? 'in_forte_calo' : d <= -1 ? 'in_calo' : 'stabile'
  return { trend, delta3h: Number(d.toFixed(1)) }
}

// ── Maree dedotte dall'altezza del livello del mare (modello, approssimato) ───
export function tideExtremes(series) {
  const out = []
  for (let i = 1; i < series.length - 1; i++) {
    const a = series[i - 1].h, b = series[i].h, c = series[i + 1].h
    if (a == null || b == null || c == null) continue
    if (b > a && b >= c) out.push({ time: series[i].time, type: 'alta', height: b })
    else if (b < a && b <= c) out.push({ time: series[i].time, type: 'bassa', height: b })
  }
  return out
}

// ── Fonti ─────────────────────────────────────────────────────────────────────

const omPanel = (lat, lng) => cached(`omp2:${ck(lat, lng)}`, 15 * 60e3, () => getJson(
  `${OM}?latitude=${lat}&longitude=${lng}&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,is_day`
  + `&hourly=temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,pressure_msl`
  + `&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,uv_index_max`
  + `&forecast_days=16&past_hours=${PAST_HOURS}&wind_speed_unit=kmh&timezone=auto`))

// Stesse variabili del pannello Open-Meteo ma dal modello italiano; 3 giorni, niente ore passate (le dà la richiesta generica).
// Le variabili che il modello non ha (es. probabilità di pioggia, UV) arrivano null e si completano dalla richiesta generica.
const omIcon = (lat, lng) => cached(`omi2:${ck(lat, lng)}`, 15 * 60e3, () => getJson(
  `${OM}?latitude=${lat}&longitude=${lng}&models=${ICON2I_MODEL}&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,is_day`
  + `&hourly=temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,pressure_msl`
  + `&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,uv_index_max`
  + `&forecast_days=3&wind_speed_unit=kmh&timezone=auto`))

const omMarine = (lat, lng) => cached(`omm3:${ck(lat, lng)}`, 30 * 60e3, () => getJson(
  `${OM_MARINE}?latitude=${lat}&longitude=${lng}`
  + `&current=wave_height,wave_period,wave_direction,swell_wave_height,swell_wave_period,swell_wave_direction,wind_wave_height,sea_surface_temperature,sea_level_height_msl,ocean_current_velocity,ocean_current_direction`
  + `&hourly=wave_height,wave_period,sea_surface_temperature,sea_level_height_msl&daily=wave_height_max&forecast_days=8&timezone=auto`))

// ── Costruzione risposta ──────────────────────────────────────────────────────
function fromGoogle(c, hours, days) {
  const cur = c ? {
    condition: gCondition(c.weatherCondition?.type, kmh(c.wind?.speed)),
    wmo: googleTypeToWmo(c.weatherCondition?.type),
    description: c.weatherCondition?.description?.text ?? null,
    isDay: typeof c.isDaytime === 'boolean' ? c.isDaytime : null,
    temp: num(c.temperature?.degrees),
    feelsLike: num(c.feelsLikeTemperature?.degrees),
    humidity: num(c.relativeHumidity),
    pressure: num(c.airPressure?.meanSeaLevelMillibars),
    windSpeed: kmh(c.wind?.speed),
    windGust: kmh(c.wind?.gust),
    windDeg: num(c.wind?.direction?.degrees),
    cloudCover: num(c.cloudCover),
    uvIndex: num(c.uvIndex),
    visibilityKm: num(c.visibility?.distance),
    precipProbability: num(c.precipitation?.probability?.percent),
    precipMm: num(c.precipitation?.qpf?.quantity),
  } : null
  const hourly = (hours?.forecastHours || []).slice(0, 48).map(h => ({
    time: h.interval?.startTime ?? null,
    date: h.displayDateTime ? ymd(h.displayDateTime) : null,
    hour: h.displayDateTime?.hours ?? null,
    source: 'google',
    condition: gCondition(h.weatherCondition?.type, kmh(h.wind?.speed)),
    wmo: googleTypeToWmo(h.weatherCondition?.type),
    temp: num(h.temperature?.degrees),
    precipProbability: num(h.precipitation?.probability?.percent),
    precipMm: num(h.precipitation?.qpf?.quantity),
    windSpeed: kmh(h.wind?.speed),
    windGust: kmh(h.wind?.gust),
    windDeg: num(h.wind?.direction?.degrees),
    pressure: num(h.airPressure?.meanSeaLevelMillibars),
  }))
  const daily = (days?.forecastDays || []).slice(0, 10).map(d => {
    const day = d.daytimeForecast || {}, night = d.nighttimeForecast || {}
    const ws = [kmh(day.wind?.speed), kmh(night.wind?.speed)].filter(v => v != null)
    return {
      date: d.displayDate ? ymd(d.displayDate) : null,
      source: 'google',
      condition: gCondition(day.weatherCondition?.type || night.weatherCondition?.type, ws.length ? Math.max(...ws) : 0),
      wmo: googleTypeToWmo(day.weatherCondition?.type || night.weatherCondition?.type),
      precipSum: sumOf(day.precipitation?.qpf?.quantity, night.precipitation?.qpf?.quantity),
      windGust: maxOf(kmh(day.wind?.gust), kmh(night.wind?.gust)),
      tempMax: num(d.maxTemperature?.degrees),
      tempMin: num(d.minTemperature?.degrees),
      precipProbability: num(day.precipitation?.probability?.percent),
      windSpeed: ws.length ? Math.max(...ws) : null,
      sunrise: d.sunEvents?.sunriseTime ?? null,
      sunset: d.sunEvents?.sunsetTime ?? null,
      moonPhase: d.moonEvents?.moonPhase ?? null,
    }
  })
  return { cur, hourly, daily, pressure3hAgo: null, pressureHistory: [] }
}

function fromOpenMeteo(om, src = 'open-meteo') {
  if (!om?.current) return null
  const c = om.current, h = om.hourly || {}, d = om.daily || {}
  const nowIdx = (h.time || []).findIndex(t => t >= c.time)
  const i0 = nowIdx < 0 ? PAST_HOURS : nowIdx
  const row = (t, j) => ({
    time: t, date: t.slice(0, 10), hour: Number(t.slice(11, 13)), source: src,
    condition: omCondition(h.weather_code?.[j], h.wind_speed_10m?.[j]),
    wmo: num(h.weather_code?.[j]),
    temp: num(h.temperature_2m?.[j]),
    precipProbability: num(h.precipitation_probability?.[j]),
    precipMm: num(h.precipitation?.[j]),
    windSpeed: num(h.wind_speed_10m?.[j]),
    windGust: num(h.wind_gusts_10m?.[j]),
    windDeg: num(h.wind_direction_10m?.[j]),
    pressure: num(h.pressure_msl?.[j]),
  })
  const hourly = (h.time || []).slice(i0, i0 + 168).map((t, k) => row(t, i0 + k))
  // Ore di oggi già trascorse (dalla mezzanotte locale): servono solo al calcolo dell'attività, non vanno nell'elenco.
  const todayDate = c.time.slice(0, 10)
  const pastToday = (h.time || []).slice(0, i0).map((t, j) => row(t, j)).filter(r => r.date === todayDate)
  const daily = (d.time || []).slice(0, 15).map((date, k) => ({
    date, source: src,
    condition: omCondition(d.weather_code?.[k], d.wind_speed_10m_max?.[k]),
    wmo: num(d.weather_code?.[k]),
    precipSum: num(d.precipitation_sum?.[k]), windGust: num(d.wind_gusts_10m_max?.[k]),
    tempMax: num(d.temperature_2m_max?.[k]), tempMin: num(d.temperature_2m_min?.[k]),
    precipProbability: num(d.precipitation_probability_max?.[k]),
    windSpeed: num(d.wind_speed_10m_max?.[k]),
    sunrise: d.sunrise?.[k] ?? null, sunset: d.sunset?.[k] ?? null, moonPhase: null,
  }))
  const cur = {
    condition: omCondition(c.weather_code, c.wind_speed_10m),
    wmo: num(c.weather_code),
    description: null,
    isDay: c.is_day == null ? null : !!c.is_day,
    temp: num(c.temperature_2m), feelsLike: num(c.apparent_temperature), humidity: num(c.relative_humidity_2m),
    pressure: num(c.pressure_msl), windSpeed: num(c.wind_speed_10m), windGust: num(c.wind_gusts_10m),
    windDeg: num(c.wind_direction_10m), cloudCover: num(c.cloud_cover), uvIndex: num(d.uv_index_max?.[0]),
    visibilityKm: null, precipProbability: num(h.precipitation_probability?.[i0]), precipMm: num(c.precipitation),
  }
  const pressure3hAgo = i0 >= 3 ? num(h.pressure_msl?.[i0 - 3]) : null
  const pressureHistory = (h.pressure_msl || []).slice(Math.max(0, i0 - 5), i0 + 1).filter(v => v != null)
  return { cur, hourly, pastToday, daily, pressure3hAgo, pressureHistory, pressureNow: num(h.pressure_msl?.[i0]), utcOffset: Number(om.utc_offset_seconds) || 0 }
}

// ICON-2I: stessa forma di Open-Meteo, ma solo le ore con dato (max 72 da adesso) e i giorni con temperatura.
// Fuori copertura o con risposta vuota restituisce null e il chiamante usa le fonti di sempre.
export function fromIcon(raw) {
  const r = fromOpenMeteo(raw, 'icon-2i')
  if (!r || r.cur.temp == null) return null
  r.hourly = r.hourly.filter(x => x.temp != null).slice(0, ICON2I_HOURS)
  r.daily = r.daily.filter(d => d.tempMax != null && d.tempMin != null).slice(0, 3)
  if (!r.hourly.length || !r.daily.length) return null
  r.pastToday = []
  return r
}

// Estende `w` con i dati di `o` oltre ciò che `w` copre (ore e giorni successivi) e completa i campi mancanti.
// Restituisce { used, extended }: `used` se `o` ha contribuito in qualche modo, `extended` se ha aggiunto ore o giorni.
const HOURS_MAX = 168, DAYS_MAX = 15
function extendWith(w, o, off, fillGaps) {
  let used = false, extended = false
  if (!w.cur) { w.cur = o.cur; used = true }
  else if (fillGaps && o.cur) for (const k of Object.keys(o.cur)) if (w.cur[k] == null && o.cur[k] != null) { w.cur[k] = o.cur[k]; used = true }
  if (!w.hourly.length) { w.hourly = o.hourly; used = used || o.hourly.length > 0 }
  else {
    if (fillGaps) {
      const byTime = new Map(o.hourly.map(r => [utcMs(r, off), r]))
      for (const r of w.hourly) if (r.precipProbability == null) { const p = byTime.get(utcMs(r, off))?.precipProbability; if (p != null) { r.precipProbability = p; used = true } }
    }
    const last = Math.max(...w.hourly.map(r => utcMs(r, off)).filter(Number.isFinite))
    const more = o.hourly.filter(r => utcMs(r, off) > last)
    if (more.length) { w.hourly = [...w.hourly, ...more].slice(0, HOURS_MAX); extended = true }
  }
  if (!w.daily.length) { w.daily = o.daily; used = used || o.daily.length > 0 }
  else {
    const have = new Set(w.daily.map(d => d.date))
    const byDate = new Map(o.daily.map(d => [d.date, d]))
    w.daily = w.daily.map(d => { const x = byDate.get(d.date); return { ...d, sunrise: d.sunrise ?? x?.sunrise ?? null, sunset: d.sunset ?? x?.sunset ?? null, precipSum: d.precipSum ?? x?.precipSum ?? null, windGust: d.windGust ?? x?.windGust ?? null, precipProbability: d.precipProbability ?? x?.precipProbability ?? null, wmo: d.wmo ?? x?.wmo ?? null } })
    const more = o.daily.filter(d => !have.has(d.date) && d.date > w.daily[w.daily.length - 1].date)
    if (more.length) { w.daily = [...w.daily, ...more].slice(0, DAYS_MAX); extended = true }
  }
  return { used: used || extended, extended }
}

function buildMarine(m) {
  const empty = { available: false, waveHeight: null, wavePeriod: null, waveDeg: null, swellHeight: null, swellPeriod: null, swellDeg: null, windWaveHeight: null, seaTemp: null, seaLevel: null, currentSpeed: null, currentDeg: null, tides: null, dailyWaveMax: [], waves: [] }
  // Se manca il blocco «current» ma ci sono le ore, si ripiega sull'ora più vicina (temperatura del mare e livello): oggi l'attività non resta senza acqua.
  const hh0 = m?.hourly || {}
  const nowIso = m?.current?.time || ''
  const k0 = (hh0.time || []).findIndex(t => t >= nowIso)
  const c = m?.current || (hh0.time?.length ? { sea_surface_temperature: hh0.sea_surface_temperature?.[Math.max(0, k0)], wave_height: hh0.wave_height?.[Math.max(0, k0)], wave_period: hh0.wave_period?.[Math.max(0, k0)] } : null)
  if (!c) return empty
  const out = {
    waveHeight: num(c.wave_height), wavePeriod: num(c.wave_period), waveDeg: num(c.wave_direction),
    swellHeight: num(c.swell_wave_height), swellPeriod: num(c.swell_wave_period), swellDeg: num(c.swell_wave_direction),
    windWaveHeight: num(c.wind_wave_height), seaTemp: num(c.sea_surface_temperature), seaLevel: num(c.sea_level_height_msl),
    currentSpeed: num(c.ocean_current_velocity), currentDeg: num(c.ocean_current_direction),
  }
  const hh = m.hourly || {}
  out.dailyWaveMax = (m.daily?.time || []).slice(0, 7).map((date, i) => ({ date, waveHeightMax: num(m.daily.wave_height_max?.[i]) }))
  const series = (hh.time || []).slice(0, 168).map((time, i) => ({ time, h: num(hh.sea_level_height_msl?.[i]) }))
  const hasTide = series.some(s => s.h != null) && new Set(series.map(s => s.h)).size > 3
  out.tides = hasTide ? { approximate: true, series: series.filter(s => s.h != null).map(s => ({ time: s.time, height: s.h })), extremes: tideExtremes(series) } : null
  // Altezza, periodo dell'onda e temperatura del mare ora per ora (7 giorni, dalla mezzanotte di oggi) per i grafici del mare e per il dettaglio del giorno; vuota se il modello non copre il punto.
  const waves = (hh.time || []).slice(0, 168).map((time, i) => ({ time, height: num(hh.wave_height?.[i]), period: num(hh.wave_period?.[i]), seaTemp: num(hh.sea_surface_temperature?.[i]) }))
  out.waves = waves.some(w => w.height != null) ? waves : []
  out.available = [out.waveHeight, out.wavePeriod, out.seaTemp].some(v => v != null)
  return out.available ? out : empty
}

// Istante UTC (ms) di una riga: Google dà un ISO con «Z»; Open-Meteo dà l'ora locale del luogo (si toglie l'offset).
const utcMs = (row, off) => (row.source === 'google' ? Date.parse(row.time) : Date.parse(`${row.time}:00Z`) - off * 1000)

export async function getOverview(reqLat, reqLng) {
  const { lat, lng } = cellOf(reqLat, reqLng) // griglia 0,05°: risposta condivisa tra utenti vicini
  const useG = !!googleKey()
  // ICON-2I per l'Italia: se risponde copre da solo l'ora corrente e le prime 72 ore, quindi Google «attuale» e «ore» (a quota) non servono.
  const iconRaw = icon2iEnabled() && inItaly(lat, lng) ? await settle(omIcon(lat, lng)) : null
  const icon = fromIcon(iconRaw)
  const [gc, gh, gd, marineRaw, omRaw] = await Promise.all([
    useG && !icon ? settle(gCurrent(lat, lng)) : null, useG && !icon ? settle(gHours(lat, lng)) : null,
    useG ? settle(gDays(lat, lng)) : null, settle(omMarine(lat, lng)), settle(omPanel(lat, lng)),
  ])
  const g = (gc || gh || gd) ? fromGoogle(gc, gh, gd) : null
  const om = fromOpenMeteo(omRaw)
  const off = icon?.utcOffset ?? om?.utcOffset ?? 0
  // Livelli in ordine di priorità; ognuno completa il precedente oltre ciò che copre.
  const layers = [['icon-2i', icon], ['google', g], ['open-meteo', om]].filter(l => l[1])
  let w = null, extended = false
  const parts = []
  for (const [name, data] of layers) {
    if (!w) { w = data; parts.push(name); continue }
    const r = extendWith(w, data, off, !!icon && name === 'open-meteo')
    if (r.used) parts.push(name)
    if (name === 'open-meteo' && r.extended) extended = true
  }
  const source = parts.length ? parts.join('+') : null
  if (!w) { const e = new Error('Meteo non disponibile'); e.status = 502; throw e }
  // Tendenza e storico della pressione: tutto da Open-Meteo (stessa serie a livello del mare, nessuna richiesta a quota)
  const trendDelta = om?.pressureNow != null && om.pressure3hAgo != null ? om.pressureNow - om.pressure3hAgo : null
  const marine = buildMarine(marineRaw)
  const today = w.daily[0] || {}
  const moon = moonPhase()
  // Per oggi il calcolo dell'attività usa anche le ore già passate (Open-Meteo), così la giornata è completa. Proprietà non enumerabile: non finisce nella risposta.
  const view = {
    location: { lat: reqLat, lng: reqLng },
    updatedAt: new Date().toISOString(),
    current: w.cur,
    hourly: w.hourly,
    daily: w.daily,
    marine,
    fishing: {
      moon: { ...moon, googlePhase: today.moonPhase ?? null },
      sunrise: today.sunrise ?? null,
      sunset: today.sunset ?? null,
      pressure: { value: w.cur?.pressure ?? om?.pressureNow ?? null, history6h: om?.pressureHistory || [], ...(pressureTrend(trendDelta) || { trend: null, delta3h: null }) },
    },
    degraded: useG && googleQuota.isBlocked(), // quota Google al blocco: dati da cache o da ripiego
    sources: { weather: source, marine: marine.available ? 'open-meteo' : null, extended: extended ? 'open-meteo' : null, attribution: parts.includes('icon-2i') ? ICON2I_ATTRIBUTION : null },
  }
  const have = new Set(view.hourly.map(r => `${r.date}T${r.hour}`))
  const past = (om?.pastToday || []).filter(r => !have.has(`${r.date}T${r.hour}`))
  Object.defineProperty(view, 'activityHours', { value: past.length ? [...past, ...view.hourly] : view.hourly, enumerable: false })
  return attachDailyActivity(view)
}
