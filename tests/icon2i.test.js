import test from 'node:test'
import assert from 'node:assert/strict'
import { inItaly, icon2iEnabled } from '../src/utils/weather.js'
import { fromIcon, getOverview } from '../src/utils/weatherPanel.js'

// Risposta Open-Meteo finta: `hours` ore orarie a partire da oggi 00:00 (ora locale = UTC, offset 0).
function fakeOm({ hours, tempFrom = 15, days = 3, withProb = false }) {
  const start = new Date(); start.setUTCHours(0, 0, 0, 0)
  const times = Array.from({ length: hours }, (_, i) => new Date(start.getTime() + i * 3600e3).toISOString().slice(0, 16))
  const dates = Array.from({ length: days }, (_, i) => new Date(start.getTime() + i * 86400e3).toISOString().slice(0, 10))
  const now = new Date().toISOString().slice(0, 13) + ':00'
  return {
    utc_offset_seconds: 0,
    current: { time: now, temperature_2m: tempFrom, weather_code: 1, wind_speed_10m: 10, wind_direction_10m: 90, pressure_msl: 1015, is_day: 1 },
    hourly: {
      time: times, temperature_2m: times.map(() => tempFrom), weather_code: times.map(() => 1), wind_speed_10m: times.map(() => 10),
      wind_direction_10m: times.map(() => 90), pressure_msl: times.map(() => 1015), precipitation: times.map(() => 0),
      precipitation_probability: times.map(() => (withProb ? 20 : null)),
    },
    daily: { time: dates, weather_code: dates.map(() => 1), temperature_2m_max: dates.map(() => tempFrom + 5), temperature_2m_min: dates.map(() => tempFrom - 5), sunrise: dates.map(d => `${d}T06:00`), sunset: dates.map(d => `${d}T18:00`) },
  }
}

const realFetch = globalThis.fetch
const mockFetch = handler => { globalThis.fetch = async url => { const r = handler(String(url)); if (r instanceof Error) throw r; return { ok: true, status: 200, json: async () => r } } }
test.afterEach(() => { globalThis.fetch = realFetch })

test('copertura: Italia sì, fuori no', () => {
  assert.equal(inItaly(41.9, 12.5), true)    // Roma
  assert.equal(inItaly(37.5, 15.1), true)    // Catania
  assert.equal(inItaly(40.4, -3.7), false)   // Madrid
  assert.equal(inItaly(48.85, 2.35), false)  // Parigi
  assert.equal(icon2iEnabled(), true)
})

test('fromIcon: risposta senza dati → null (ripiego); con dati → solo ore valide, max 72', () => {
  assert.equal(fromIcon(null), null)
  const empty = fakeOm({ hours: 72 }); empty.current.temperature_2m = null
  assert.equal(fromIcon(empty), null)
  const r = fromIcon(fakeOm({ hours: 24 * 4 }))
  assert.ok(r.hourly.length <= 72 && r.hourly.every(h => h.source === 'icon-2i'))
  assert.ok(r.daily.length <= 3)
})

test('overview in Italia: ICON-2I per 72 ore, poi Open-Meteo; attribuzione presente', async () => {
  const urls = []
  mockFetch(u => {
    urls.push(u)
    if (u.includes('marine-api')) return new Error('no marine')
    if (u.includes('models=italia_meteo_arpae_icon_2i')) return fakeOm({ hours: 24 * 3, tempFrom: 22 })
    return fakeOm({ hours: 24 * 16, tempFrom: 10, days: 15, withProb: true })
  })
  const v = await getOverview(45.4642, 9.19)
  assert.match(v.sources.weather, /^icon-2i/)
  assert.match(v.sources.attribution, /CC BY 4\.0/)
  assert.equal(v.hourly[0].source, 'icon-2i')
  assert.equal(v.hourly[0].temp, 22)
  assert.equal(v.hourly[0].precipProbability, 20)            // completata dalla richiesta generica
  const iconRows = v.hourly.filter(h => h.source === 'icon-2i').length
  assert.ok(iconRows > 0 && iconRows <= 72)
  assert.equal(v.hourly[v.hourly.length - 1].source, 'open-meteo')
  assert.ok(v.hourly.length > iconRows && v.hourly.length <= 168)
  const ts = v.hourly.map(h => `${h.date}T${h.hour}`); assert.equal(new Set(ts).size, ts.length) // nessun doppione
  assert.equal(v.daily[0].source, 'icon-2i')
  assert.ok(v.daily.length > 3 && v.daily[v.daily.length - 1].source === 'open-meteo')
})

test('overview in Italia con ICON-2I che fallisce: ripiego Open-Meteo, nessuna attribuzione ICON', async () => {
  mockFetch(u => {
    if (u.includes('marine-api')) return new Error('no marine')
    if (u.includes('models=italia_meteo_arpae_icon_2i')) return new Error('HTTP 500')
    return fakeOm({ hours: 24 * 16, tempFrom: 10, days: 15 })
  })
  const v = await getOverview(41.9, 12.5)
  assert.equal(v.sources.weather, 'open-meteo')
  assert.equal(v.sources.attribution, null)
  assert.equal(v.hourly[0].source, 'open-meteo')
})

test('overview fuori Italia: ICON-2I non viene nemmeno richiesto', async () => {
  const urls = []
  mockFetch(u => { urls.push(u); if (u.includes('marine-api')) return new Error('x'); return fakeOm({ hours: 24 * 16, days: 15 }) })
  const v = await getOverview(40.4, -3.7)
  assert.ok(!urls.some(u => u.includes('italia_meteo_arpae_icon_2i')))
  assert.equal(v.sources.weather, 'open-meteo')
})
