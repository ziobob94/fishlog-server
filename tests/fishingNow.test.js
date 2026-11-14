import test from 'node:test'
import assert from 'node:assert/strict'
import { fishingNow, pickFactors, nextWindow } from '../src/utils/fishingDay.js'
import { loadRules } from '../src/utils/fishingActivity.js'

const rules = loadRules(null)
const DATE = '2026-07-01'
const hourly = (over = {}) => Array.from({ length: 24 }, (_, hour) => ({ date: DATE, hour, windSpeed: 8, pressure: 1015 - hour * 0.3, ...over }))
// Vista minima del pannello meteo: l'ora corrente è la prima riga di `hourly`, come in getOverview.
const view = (nowHour, extra = {}) => ({
  hourly: hourly().slice(nowHour), activityHours: hourly(), daily: [{ date: DATE, sunrise: `${DATE}T06:00`, sunset: `${DATE}T20:00` }],
  marine: { available: false }, fishing: { moon: { illumination: 0 } }, ...extra,
})

test('livello 1-5: alba con vento debole e pressione in calo → alto; mezzogiorno con vento forte → basso', () => {
  const dawn = fishingNow(view(6), rules)
  assert.ok(dawn.level >= 4, `alba: ${dawn.level}`)
  const v = view(13); v.activityHours = hourly({ windSpeed: 45, pressure: 1015 }); v.hourly = v.activityHours.slice(13)
  const noon = fishingNow(v, rules)
  assert.ok(noon.level >= 1 && noon.level <= 2, `mezzogiorno ventoso: ${noon.level}`)
  assert.ok(dawn.level > noon.level)
})
test('le soglie dei livelli si cambiano dalla config', () => {
  const strict = loadRules({ levels: [{ level: 1, max: 0.99, label: 'x' }, { level: 2, max: 1.01, label: 'y' }] })
  assert.ok(fishingNow(view(6), strict).level <= 2)
})
test('i fattori sono al massimo 3, i più influenti, con effetto up/flat/down', () => {
  const f = pickFactors({ light: 1, tide: 0.5, pressure: 1, wind: 0.1, waterTemp: 0.55 }, rules)
  assert.equal(f.length, 3)
  assert.deepEqual(f.map(x => x.key), ['light', 'pressure', 'wind'])
  assert.deepEqual(f.map(x => x.effect), ['up', 'up', 'down'])
  assert.ok(f.every(x => ['up', 'flat', 'down'].includes(x.effect)))
  // i fattori senza dato non compaiono mai
  assert.deepEqual(pickFactors({ light: 1, tide: null, pressure: undefined }, rules).map(x => x.key), ['light'])
  assert.deepEqual(pickFactors({}, rules), [])
})
test('il peso decide a parità di influenza e maxFactors è in config', () => {
  const f = pickFactors({ light: 0, tide: 0 }, loadRules({ home: { maxFactors: 1 } }))
  assert.deepEqual(f.map(x => x.key), ['light'])
})
test('dati mancanti: nessun livello inventato', () => {
  const none = { level: null, factors: [], nextWindow: null }
  // meno di 6 ore nel giorno
  const few = view(6); few.activityHours = hourly().slice(0, 3); few.hourly = few.activityHours
  assert.deepEqual({ ...fishingNow(few, rules), rulesVersion: undefined }, { ...none, rulesVersion: undefined })
  // senza alba/tramonto né marea e senza pressione: un solo fattore (vento) → nessuna stima
  const thin = view(6, { daily: [{ date: DATE }] }); thin.activityHours = hourly({ pressure: null }); thin.hourly = thin.activityHours.slice(6)
  assert.equal(fishingNow(thin, rules).level, null)
  // vista vuota o senza ore
  assert.equal(fishingNow({ hourly: [], daily: [] }, rules).level, null)
  assert.equal(fishingNow(null, rules).level, null)
})
test('prossima finestra: in corso, successiva o nessuna', () => {
  const w = [{ from: '05:00', to: '08:00' }, { from: '19:00', to: '21:00' }]
  assert.deepEqual(nextWindow(w, 6), { from: '05:00', to: '08:00', now: true })
  assert.deepEqual(nextWindow(w, 10), { from: '19:00', to: '21:00', now: false })
  assert.equal(nextWindow(w, 22), null)
  assert.deepEqual(nextWindow([{ from: '22:00', to: '00:00' }], 23), { from: '22:00', to: '00:00', now: true })
  assert.equal(nextWindow([], 5), null)
})
test('l\'output non contiene le uscite dell\'utente né promesse', () => {
  const r = fishingNow(view(6), rules)
  assert.deepEqual(Object.keys(r).sort(), ['factors', 'level', 'nextWindow', 'rulesVersion'])
})
