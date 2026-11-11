// Pannello meteo + mare per una posizione qualsiasi (GET /api/weather/overview).
// Meteo: Google Weather (attuale, ore, giorni, storico 24 h per il trend della pressione) con ripiego Open-Meteo.
// Mare: Open-Meteo Marine (gratuito). Fuori dalla copertura marina (lago, entroterra) i campi sono null e `marine.available` è false.
// Fase lunare, illuminazione e trend pressione sono calcolati/derivati qui, così il client non ha logica.
import { cached, getJson, gUrl, num, kmh, ymd, pick, settle, ck, gCondition, omCondition, OM, OM_MARINE } from './weather.js'
import { googleKey } from './weather.js'

const H = 3600e3

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
const gHistory = (lat, lng) => cached(`ghi:${ck(lat, lng)}`, 20 * 60e3, () => getJson(gUrl('history/hours:lookup', lat, lng, '&hours=6&pageSize=6')))
const gCurrent = (lat, lng) => cached(`gc:${ck(lat, lng)}`, 10 * 60e3, () => getJson(gUrl('currentConditions:lookup', lat, lng)))
const gHours = (lat, lng) => cached(`gh:${ck(lat, lng)}`, 30 * 60e3, () => getJson(gUrl('forecast/hours:lookup', lat, lng, '&hours=240&pageSize=240')))
const gDays = (lat, lng) => cached(`gd:${ck(lat, lng)}`, 30 * 60e3, () => getJson(gUrl('forecast/days:lookup', lat, lng, '&days=10&pageSize=10')))

const omPanel = (lat, lng) => cached(`omp:${ck(lat, lng)}`, 15 * 60e3, () => getJson(
  `${OM}?latitude=${lat}&longitude=${lng}&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,cloud_cover,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m,is_day`
  + `&hourly=temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,surface_pressure`
  + `&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,uv_index_max`
  + `&forecast_days=7&past_hours=6&wind_speed_unit=kmh&timezone=auto`))

const omMarine = (lat, lng) => cached(`omm2:${ck(lat, lng)}`, 30 * 60e3, () => getJson(
  `${OM_MARINE}?latitude=${lat}&longitude=${lng}`
  + `&current=wave_height,wave_period,wave_direction,swell_wave_height,swell_wave_period,swell_wave_direction,wind_wave_height,sea_surface_temperature,sea_level_height_msl,ocean_current_velocity,ocean_current_direction`
  + `&hourly=wave_height,wave_period,sea_surface_temperature,sea_level_height_msl&daily=wave_height_max&forecast_days=7&timezone=auto`))

// ── Costruzione risposta ──────────────────────────────────────────────────────
function fromGoogle(c, hours, days, hist) {
  const cur = c ? {
    condition: gCondition(c.weatherCondition?.type, kmh(c.wind?.speed)),
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
    hour: h.displayDateTime?.hours ?? null,
    condition: gCondition(h.weatherCondition?.type, kmh(h.wind?.speed)),
    temp: num(h.temperature?.degrees),
    precipProbability: num(h.precipitation?.probability?.percent),
    precipMm: num(h.precipitation?.qpf?.quantity),
    windSpeed: kmh(h.wind?.speed),
    windGust: kmh(h.wind?.gust),
    windDeg: num(h.wind?.direction?.degrees),
    pressure: num(h.airPressure?.meanSeaLevelMillibars),
  }))
  const daily = (days?.forecastDays || []).slice(0, 7).map(d => {
    const day = d.daytimeForecast || {}, night = d.nighttimeForecast || {}
    const ws = [kmh(day.wind?.speed), kmh(night.wind?.speed)].filter(v => v != null)
    return {
      date: d.displayDate ? ymd(d.displayDate) : null,
      condition: gCondition(day.weatherCondition?.type || night.weatherCondition?.type, ws.length ? Math.max(...ws) : 0),
      tempMax: num(d.maxTemperature?.degrees),
      tempMin: num(d.minTemperature?.degrees),
      precipProbability: num(day.precipitation?.probability?.percent),
      windSpeed: ws.length ? Math.max(...ws) : null,
      sunrise: d.sunEvents?.sunriseTime ?? null,
      sunset: d.sunEvents?.sunsetTime ?? null,
      moonPhase: d.moonEvents?.moonPhase ?? null,
    }
  })
  const past = (hist?.historyHours || []).map(h => num(h.airPressure?.meanSeaLevelMillibars)).filter(v => v != null)
  const pressure3hAgo = past.length >= 3 ? past[Math.min(2, past.length - 1)] : null // storico: più recente per primo
  return { cur, hourly, daily, pressure3hAgo, pressureHistory: past.slice().reverse() }
}

function fromOpenMeteo(om) {
  if (!om?.current) return null
  const c = om.current, h = om.hourly || {}, d = om.daily || {}
  const nowIdx = (h.time || []).findIndex(t => t >= c.time)
  const i0 = nowIdx < 0 ? 6 : nowIdx
  const hourly = (h.time || []).slice(i0, i0 + 48).map((t, k) => ({
    time: t, hour: Number(t.slice(11, 13)),
    condition: omCondition(h.weather_code?.[i0 + k], h.wind_speed_10m?.[i0 + k]),
    temp: num(h.temperature_2m?.[i0 + k]),
    precipProbability: num(h.precipitation_probability?.[i0 + k]),
    precipMm: num(h.precipitation?.[i0 + k]),
    windSpeed: num(h.wind_speed_10m?.[i0 + k]),
    windGust: num(h.wind_gusts_10m?.[i0 + k]),
    windDeg: num(h.wind_direction_10m?.[i0 + k]),
    pressure: num(h.surface_pressure?.[i0 + k]),
  }))
  const daily = (d.time || []).map((date, k) => ({
    date,
    condition: omCondition(d.weather_code?.[k], d.wind_speed_10m_max?.[k]),
    tempMax: num(d.temperature_2m_max?.[k]), tempMin: num(d.temperature_2m_min?.[k]),
    precipProbability: num(d.precipitation_probability_max?.[k]),
    windSpeed: num(d.wind_speed_10m_max?.[k]),
    sunrise: d.sunrise?.[k] ?? null, sunset: d.sunset?.[k] ?? null, moonPhase: null,
  }))
  const cur = {
    condition: omCondition(c.weather_code, c.wind_speed_10m),
    description: null,
    isDay: c.is_day == null ? null : !!c.is_day,
    temp: num(c.temperature_2m), feelsLike: num(c.apparent_temperature), humidity: num(c.relative_humidity_2m),
    pressure: num(c.surface_pressure), windSpeed: num(c.wind_speed_10m), windGust: num(c.wind_gusts_10m),
    windDeg: num(c.wind_direction_10m), cloudCover: num(c.cloud_cover), uvIndex: num(d.uv_index_max?.[0]),
    visibilityKm: null, precipProbability: num(h.precipitation_probability?.[i0]), precipMm: num(c.precipitation),
  }
  const pressure3hAgo = i0 >= 3 ? num(h.surface_pressure?.[i0 - 3]) : null
  const pressureHistory = (h.surface_pressure || []).slice(Math.max(0, i0 - 5), i0 + 1).filter(v => v != null)
  return { cur, hourly, daily, pressure3hAgo, pressureHistory }
}

function buildMarine(m) {
  const empty = { available: false, waveHeight: null, wavePeriod: null, waveDeg: null, swellHeight: null, swellPeriod: null, swellDeg: null, windWaveHeight: null, seaTemp: null, seaLevel: null, currentSpeed: null, currentDeg: null, tides: null, dailyWaveMax: [] }
  const c = m?.current
  if (!c) return empty
  const out = {
    waveHeight: num(c.wave_height), wavePeriod: num(c.wave_period), waveDeg: num(c.wave_direction),
    swellHeight: num(c.swell_wave_height), swellPeriod: num(c.swell_wave_period), swellDeg: num(c.swell_wave_direction),
    windWaveHeight: num(c.wind_wave_height), seaTemp: num(c.sea_surface_temperature), seaLevel: num(c.sea_level_height_msl),
    currentSpeed: num(c.ocean_current_velocity), currentDeg: num(c.ocean_current_direction),
  }
  const hh = m.hourly || {}
  out.dailyWaveMax = (m.daily?.time || []).map((date, i) => ({ date, waveHeightMax: num(m.daily.wave_height_max?.[i]) }))
  const series = (hh.time || []).slice(0, 48).map((time, i) => ({ time, h: num(hh.sea_level_height_msl?.[i]) }))
  const hasTide = series.some(s => s.h != null) && new Set(series.map(s => s.h)).size > 3
  out.tides = hasTide ? { approximate: true, series: series.filter(s => s.h != null).map(s => ({ time: s.time, height: s.h })), extremes: tideExtremes(series) } : null
  out.available = [out.waveHeight, out.wavePeriod, out.seaTemp].some(v => v != null)
  return out.available ? out : empty
}

export async function getOverview(lat, lng) {
  const useG = !!googleKey()
  const [gc, gh, gd, ghist, marineRaw] = await Promise.all([
    useG ? settle(gCurrent(lat, lng)) : null, useG ? settle(gHours(lat, lng)) : null,
    useG ? settle(gDays(lat, lng)) : null, useG ? settle(gHistory(lat, lng)) : null, settle(omMarine(lat, lng)),
  ])
  let w = (gc || gh || gd) ? fromGoogle(gc, gh, gd, ghist) : null
  let source = w ? 'google' : null
  // Ripiego Open-Meteo se Google manca del tutto o lascia buchi nei blocchi principali
  if (!w?.cur || !w.hourly.length || !w.daily.length || w.pressure3hAgo == null) {
    const om = fromOpenMeteo(await settle(omPanel(lat, lng)))
    if (om) {
      if (!w) { w = om; source = 'open-meteo' } else {
        w.cur = w.cur || om.cur
        if (!w.hourly.length) w.hourly = om.hourly
        if (!w.daily.length) w.daily = om.daily
        else w.daily = w.daily.map((d, i) => ({ ...d, sunrise: d.sunrise ?? om.daily[i]?.sunrise ?? null, sunset: d.sunset ?? om.daily[i]?.sunset ?? null }))
        if (w.pressure3hAgo == null) { w.pressure3hAgo = om.pressure3hAgo; w.pressureHistory = om.pressureHistory }
        source = 'google+open-meteo'
      }
    }
  }
  if (!w) { const e = new Error('Meteo non disponibile'); e.status = 502; throw e }
  const marine = buildMarine(marineRaw)
  const today = w.daily[0] || {}
  const moon = moonPhase()
  return {
    location: { lat, lng },
    updatedAt: new Date().toISOString(),
    current: w.cur,
    hourly: w.hourly,
    daily: w.daily,
    marine,
    fishing: {
      moon: { ...moon, googlePhase: today.moonPhase ?? null },
      sunrise: today.sunrise ?? null,
      sunset: today.sunset ?? null,
      pressure: { value: w.cur?.pressure ?? null, history6h: w.pressureHistory || [], ...(pressureTrend(w.cur?.pressure != null && w.pressure3hAgo != null ? w.cur.pressure - w.pressure3hAgo : null) || { trend: null, delta3h: null }) },
    },
    sources: { weather: source, marine: marine.available ? 'open-meteo' : null },
  }
}
