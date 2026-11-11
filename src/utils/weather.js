// Meteo per uscite e Home. Provider principale: Google Weather API (chiamata dal SERVER con chiave
// separata, mai esposta al client). Open-Meteo resta come ripiego per ciò che Google non fornisce:
//  - dati marini (altezza/periodo onde, temperatura del mare): Google non li ha, restano Open-Meteo;
//  - date passate oltre le ultime 24 h e oltre i 10 giorni di previsione (Google non ha storico/archivio lungo);
//  - singoli campi mancanti nella risposta Google.
// Il formato di risposta è lo stesso per entrambi i provider; `sources` dice da dove arriva ogni gruppo di campi.
import AppConfig from '../config.js'

const config = new AppConfig()
const GW = 'https://weather.googleapis.com/v1'
const OM = 'https://api.open-meteo.com/v1/forecast'
const OM_ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive'
const OM_MARINE = 'https://marine-api.open-meteo.com/v1/marine'

export const googleKey = () => (process.env.GOOGLE_WEATHER_KEY || config.get('google.weatherKey', '') || '').trim()

async function getJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) })
  if (!r.ok) { const e = new Error(`HTTP ${r.status}`); e.status = r.status; throw e }
  return r.json()
}
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const pick = (...vs) => { for (const v of vs) if (v != null) return v; return null }

// ── Cache breve in memoria (le coordinate a 2 decimali ≈ 1 km) ────────────────
const cache = new Map()
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key)
  if (hit && hit.exp > Date.now()) return hit.val
  const val = await fn()
  cache.set(key, { val, exp: Date.now() + ttlMs })
  if (cache.size > 500) for (const [k, v] of cache) if (v.exp < Date.now()) cache.delete(k)
  return val
}
const ck = (lat, lng) => `${Number(lat).toFixed(2)},${Number(lng).toFixed(2)}`

// ── Mappature ─────────────────────────────────────────────────────────────────
// Condizioni dell'app: sole | nuvoloso | coperto | nebbia | pioggia | vento
export function wmoToCondition(code, windSpeed) {
  if (windSpeed >= 30) return 'vento'
  if (code === 0) return 'sole'
  if (code <= 2) return 'nuvoloso'
  if (code === 3) return 'coperto'
  if (code === 45 || code === 48) return 'nebbia'
  if (code >= 51 && code <= 86) return 'pioggia'
  if (code >= 95) return 'pioggia'
  return 'nuvoloso'
}
// Tipi di condizione Google (es. CLEAR, PARTLY_CLOUDY, LIGHT_RAIN, THUNDERSTORM, FOG…) → condizione dell'app
export function googleTypeToCondition(type, windSpeed) {
  const t = String(type || '').toUpperCase()
  if (!t) return null
  if (/FOG|HAZE|MIST/.test(t)) return 'nebbia'
  if (/RAIN|SHOWER|DRIZZLE|THUNDER|STORM|SNOW|SLEET|HAIL|FLURR/.test(t)) return 'pioggia'
  if (windSpeed >= 30 || /^WINDY$/.test(t)) return 'vento'
  if (t === 'CLEAR' || t === 'MOSTLY_CLEAR' || t === 'SUNNY') return 'sole'
  if (t === 'CLOUDY' || t === 'OVERCAST') return 'coperto'
  if (/CLOUD/.test(t)) return 'nuvoloso'
  return 'nuvoloso'
}
// Velocità vento di Google → km/h (con unitsSystem=METRIC è già km/h; per sicurezza si converte)
function kmh(speed) {
  const v = num(speed?.value); if (v == null) return null
  const u = String(speed?.unit || 'KILOMETERS_PER_HOUR').toUpperCase()
  if (u.includes('MILES')) return v * 1.609344
  if (u.includes('METERS_PER_SECOND')) return v * 3.6
  if (u.includes('KNOT')) return v * 1.852
  return v
}
const ymd = d => `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`

// ── Google ────────────────────────────────────────────────────────────────────
function gUrl(path, lat, lng, extra = '') {
  return `${GW}/${path}?key=${encodeURIComponent(googleKey())}&location.latitude=${lat}&location.longitude=${lng}&unitsSystem=METRIC&languageCode=it${extra}`
}
const gCurrent = (lat, lng) => cached(`gc:${ck(lat, lng)}`, 10 * 60e3, () => getJson(gUrl('currentConditions:lookup', lat, lng)))
const gDays = (lat, lng) => cached(`gd:${ck(lat, lng)}`, 30 * 60e3, () => getJson(gUrl('forecast/days:lookup', lat, lng, '&days=10&pageSize=10')))
const gHours = (lat, lng) => cached(`gh:${ck(lat, lng)}`, 30 * 60e3, () => getJson(gUrl('forecast/hours:lookup', lat, lng, '&hours=240&pageSize=240')))

// ── Open-Meteo (ripiego e dati marini) ────────────────────────────────────────
async function omDay(lat, lng, date) {
  const today = new Date().toISOString().split('T')[0]
  const base = date < today ? OM_ARCHIVE : OM
  return cached(`omd:${ck(lat, lng)}:${date}`, 30 * 60e3, () => getJson(`${base}?latitude=${lat}&longitude=${lng}&start_date=${date}&end_date=${date}&daily=weather_code,temperature_2m_max,temperature_2m_min,wind_speed_10m_max,wind_direction_10m_dominant&hourly=surface_pressure,relative_humidity_2m&timezone=auto`))
}
async function omMarineDay(lat, lng, date) {
  return cached(`omm:${ck(lat, lng)}:${date}`, 60 * 60e3, () => getJson(`${OM_MARINE}?latitude=${lat}&longitude=${lng}&start_date=${date}&end_date=${date}&daily=wave_height_max,wave_period_max&timezone=auto`))
}
async function omMarineNow(lat, lng) {
  return cached(`omn:${ck(lat, lng)}`, 10 * 60e3, () => getJson(`${OM_MARINE}?latitude=${lat}&longitude=${lng}&current=wave_height,wave_period,sea_surface_temperature&timezone=auto`))
}
async function omNow(lat, lng) {
  return cached(`omc:${ck(lat, lng)}`, 10 * 60e3, () => getJson(`${OM}?latitude=${lat}&longitude=${lng}&current=temperature_2m,wind_speed_10m,wind_direction_10m,surface_pressure&wind_speed_unit=kmh&timezone=auto`))
}
const settle = p => p.then(v => v, () => null)

// ── Condizioni attuali (Home) ─────────────────────────────────────────────────
// → { tempAir, windSpeed (km/h), windDeg, pressure (hPa), waveHeight, wavePeriod, waterTemp, sources }
export async function getCurrent(lat, lng) {
  const out = { tempAir: null, windSpeed: null, windDeg: null, pressure: null, waveHeight: null, wavePeriod: null, waterTemp: null }
  const sources = { weather: null, marine: null }
  const useG = !!googleKey()
  const [g, marine] = await Promise.all([useG ? settle(gCurrent(lat, lng)) : null, settle(omMarineNow(lat, lng))])
  if (g) {
    out.tempAir = num(g.temperature?.degrees)
    out.windSpeed = kmh(g.wind?.speed)
    out.windDeg = num(g.wind?.direction?.degrees)
    out.pressure = num(g.airPressure?.meanSeaLevelMillibars)
    if ([out.tempAir, out.windSpeed, out.pressure].some(v => v != null)) sources.weather = 'google'
  }
  if (out.tempAir == null || out.windSpeed == null || out.windDeg == null || out.pressure == null) {
    const om = await settle(omNow(lat, lng))
    if (om?.current) {
      out.tempAir = pick(out.tempAir, num(om.current.temperature_2m))
      out.windSpeed = pick(out.windSpeed, num(om.current.wind_speed_10m))
      out.windDeg = pick(out.windDeg, num(om.current.wind_direction_10m))
      out.pressure = pick(out.pressure, num(om.current.surface_pressure))
      sources.weather = sources.weather ? 'google+open-meteo' : 'open-meteo'
    }
  }
  if (marine?.current) {
    out.waveHeight = num(marine.current.wave_height)
    out.wavePeriod = num(marine.current.wave_period)
    out.waterTemp = num(marine.current.sea_surface_temperature)
    sources.marine = 'open-meteo'
  }
  return { ...out, sources }
}

// ── Giornata di un'uscita (autofill / «Ricalcola») ────────────────────────────
// → { condition, tempAir (media max/min), tempMax, tempMin, windSpeed (km/h, max), windDeg, pressure, humidity, waveHeight, wavePeriod, sources }
export async function getDay(lat, lng, date, hour = 12, marine = false) {
  const out = { condition: null, tempAir: null, tempMax: null, tempMin: null, windSpeed: null, windDeg: null, pressure: null, humidity: null, waveHeight: null, wavePeriod: null }
  const sources = { weather: null, marine: null }
  const today = new Date().toISOString().split('T')[0]
  const diffDays = Math.round((Date.parse(date) - Date.parse(today)) / 86400000)
  const inGoogleRange = diffDays >= 0 && diffDays < 10

  if (googleKey() && inGoogleRange) {
    const [days, hours] = await Promise.all([settle(gDays(lat, lng)), settle(gHours(lat, lng))])
    const d = days?.forecastDays?.find(x => x.displayDate && ymd(x.displayDate) === date)
    if (d) {
      const day = d.daytimeForecast || {}, night = d.nighttimeForecast || {}
      out.tempMax = num(d.maxTemperature?.degrees)
      out.tempMin = num(d.minTemperature?.degrees)
      const ws = [kmh(day.wind?.speed), kmh(night.wind?.speed)].filter(v => v != null)
      out.windSpeed = ws.length ? Math.max(...ws) : null
      out.windDeg = pick(num(day.wind?.direction?.degrees), num(night.wind?.direction?.degrees))
      out.humidity = pick(num(day.relativeHumidity), num(night.relativeHumidity))
      out.condition = googleTypeToCondition(day.weatherCondition?.type || night.weatherCondition?.type, out.windSpeed)
    }
    const h = hours?.forecastHours?.find(x => x.displayDateTime && ymd(x.displayDateTime) === date && (x.displayDateTime.hours ?? 0) === hour)
    if (h) out.pressure = num(h.airPressure?.meanSeaLevelMillibars)
    if (out.pressure == null && diffDays === 0) {
      const c = await settle(gCurrent(lat, lng)); out.pressure = num(c?.airPressure?.meanSeaLevelMillibars)
    }
    if ([out.condition, out.tempMax, out.windSpeed, out.pressure].some(v => v != null)) sources.weather = 'google'
  }

  const missing = out.condition == null || out.tempMax == null || out.tempMin == null || out.windSpeed == null || out.windDeg == null || out.pressure == null
  if (missing) {
    const om = await settle(omDay(lat, lng, date))
    if (om?.daily) {
      const d = om.daily
      const ws = num(d.wind_speed_10m_max?.[0])
      out.tempMax = pick(out.tempMax, num(d.temperature_2m_max?.[0]))
      out.tempMin = pick(out.tempMin, num(d.temperature_2m_min?.[0]))
      out.windSpeed = pick(out.windSpeed, ws)
      out.windDeg = pick(out.windDeg, num(d.wind_direction_10m_dominant?.[0]))
      if (out.condition == null && num(d.weather_code?.[0]) != null) out.condition = wmoToCondition(d.weather_code[0], out.windSpeed)
      out.pressure = pick(out.pressure, num(om.hourly?.surface_pressure?.[hour]))
      out.humidity = pick(out.humidity, num(om.hourly?.relative_humidity_2m?.[hour]))
      sources.weather = sources.weather ? 'google+open-meteo' : 'open-meteo'
    }
  }
  if (out.tempMax != null && out.tempMin != null) out.tempAir = Math.round((out.tempMax + out.tempMin) / 2)

  if (marine) {
    const m = await settle(omMarineDay(lat, lng, date))
    if (m?.daily) {
      out.waveHeight = num(m.daily.wave_height_max?.[0])
      out.wavePeriod = num(m.daily.wave_period_max?.[0])
      if (out.waveHeight != null || out.wavePeriod != null) sources.marine = 'open-meteo'
    }
  }
  return { ...out, sources }
}

// Interni riusati da weatherPanel.js
export { cached, getJson, gUrl, num, kmh, ymd, pick, settle, ck, googleTypeToCondition as gCondition, wmoToCondition as omCondition, OM, OM_MARINE }
