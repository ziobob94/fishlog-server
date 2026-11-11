import test from 'node:test'
import assert from 'node:assert/strict'
import { lightScore, windScore, waterTempScore, pressureScore, tideScores, combine, activityForDay, windowsOf, reliabilityOf, mergeRules, loadRules, levelOf } from '../src/utils/fishingActivity.js'
import { likelySpecies, tempFit } from '../src/utils/speciesLikelihood.js'
import { googleTypeToWmo } from '../src/utils/weatherPanel.js'

test('luce: picco all\'alba, minimo di notte senza luna', () => {
  assert.ok(lightScore(6, '2026-07-01T06:00', '2026-07-01T20:00', 0) > 0.8)
  assert.ok(lightScore(13, '2026-07-01T06:00', '2026-07-01T20:00', 0) < 0.5)
  assert.ok(lightScore(2, '2026-07-01T06:00', '2026-07-01T20:00', 1) > lightScore(2, '2026-07-01T06:00', '2026-07-01T20:00', 0))
  assert.equal(lightScore(6, null, null, 0), null)
})
test('vento, temperatura acqua, pressione', () => {
  assert.equal(windScore(10), 1)
  assert.equal(windScore(50), 0.1)
  assert.equal(windScore(null), null)
  assert.equal(waterTempScore(18), 1)
  assert.ok(waterTempScore(8) < 0.4)
  assert.equal(pressureScore(-1.5), 1)
  assert.equal(pressureScore(0.2), 0.6)
  assert.ok(pressureScore(-5) < pressureScore(-1.5))
  assert.equal(pressureScore(undefined), null)
})
test('marea: movimento alto a metà, quasi fermo ai colmi; marea trascurabile = nessun fattore', () => {
  const h = Array.from({ length: 24 }, (_, i) => Math.sin((i / 12) * Math.PI)) // ~1 ciclo in 24 h
  const s = tideScores(h)
  // sin(i·π/12): il livello cambia più in fretta a i=0 e 24 (zero), è fermo a i=6 e 18 (colmi)
  assert.ok(s[6] < 0.3 && s[12] > 0.9)
  assert.ok(tideScores(h.map(() => 0.01)).every(v => v === null))
})
test('combine rinormalizza i pesi e richiede almeno 2 fattori', () => {
  assert.equal(combine({ light: 1 }), null)
  assert.equal(combine({ light: 1, wind: 1, tide: null }), 1)
  const v = combine({ light: 1, wind: 0 })
  assert.ok(Math.abs(v - 0.3 / 0.45) < 1e-9)
})
test('config: override con merge profondo, default intatto', () => {
  const r = loadRules({ wind: { idealMaxKmh: 5 } })
  assert.equal(r.wind.idealMaxKmh, 5)
  assert.equal(r.wind.badKmh, 35)
  assert.equal(mergeRules({ a: 1 }, null).a, 1)
  assert.equal(windScore(10, r) < 1, true)
})
test('livelli e affidabilità', () => {
  assert.equal(levelOf(0.1).level, 1)
  assert.equal(levelOf(0.9).level, 5)
  assert.equal(levelOf(null), null)
  assert.deepEqual([0, 2, 3, 6, 7, 14].map(reliabilityOf), ['alta', 'alta', 'media', 'media', 'bassa', 'bassa'])
})

const day = (date = '2026-07-01') => Array.from({ length: 24 }, (_, hour) => ({ date, hour, windSpeed: 8, pressure: 1015 - hour * 0.3 }))
test('activityForDay: ore, finestre e fattori; null con pochi dati', () => {
  const a = activityForDay({ date: '2026-07-01', hourly: day(), sunrise: '2026-07-01T06:00', sunset: '2026-07-01T20:00' })
  assert.equal(a.hours.length, 24)
  assert.ok(a.windows.length >= 1 && a.windows.length <= 2)
  assert.ok(a.factors.light && a.factors.wind && a.factors.pressure)
  assert.equal(a.factors.tide, null)
  assert.equal(a.factors.waterTemp, null)
  assert.equal(activityForDay({ date: '2026-07-01', hourly: day().slice(0, 3), sunrise: '2026-07-01T06:00', sunset: '2026-07-01T20:00' }), null)
  // senza luce né pressione resta un solo fattore: nessuna stima
  assert.equal(activityForDay({ date: '2026-07-01', hourly: day().map(h => ({ ...h, pressure: null })) }), null)
})
test('windowsOf: finestre consecutive, al massimo due', () => {
  const sc = [5, 6, 7, 17, 18, 19].map(h => ({ hour: h, score: 0.9 })).concat([12].map(h => ({ hour: h, score: 0.3 })))
  const w = windowsOf(sc)
  assert.deepEqual(w, [{ from: '05:00', to: '08:00' }, { from: '17:00', to: '20:00' }])
  assert.deepEqual(windowsOf([{ hour: 3, score: 0.3 }]), [])
})

test('specie: fuori stagione e acqua fredda scendono; storico utente sale; oltre 7 giorni solo stagione', () => {
  const summer = likelySpecies({ month: 7, water: 'mare', waterTemp: 24 })
  const winter = likelySpecies({ month: 1, water: 'mare', waterTemp: 11 })
  assert.equal(summer.basis, 'condizioni')
  assert.ok(summer.items.find(s => s.name === 'Orata').score > (winter.items.find(s => s.name === 'Orata')?.score ?? 0))
  const own = likelySpecies({ month: 7, water: 'mare', waterTemp: 24, userCounts: new Map([['orata', 3]]) })
  assert.equal(own.items.find(s => s.name === 'Orata').userCatches, 3)
  assert.ok(own.items.find(s => s.name === 'Orata').score >= summer.items.find(s => s.name === 'Orata').score)
  const far = likelySpecies({ month: 7, water: 'mare' })
  assert.equal(far.basis, 'stagione')
  assert.ok(far.items.length > 0)
  assert.ok(!likelySpecies({ month: 7, water: 'dolce' }).items.some(s => s.name === 'Orata'))
  assert.equal(tempFit(null, [10, 20]), null)
})
test('WMO dai tipi Google', () => {
  assert.equal(googleTypeToWmo('CLEAR'), 0)
  assert.equal(googleTypeToWmo('PARTLY_CLOUDY'), 2)
  assert.equal(googleTypeToWmo('LIGHT_RAIN'), 61)
  assert.equal(googleTypeToWmo('THUNDERSTORM'), 95)
  assert.equal(googleTypeToWmo(undefined), null)
})

test('oggi a fine giornata: con le ore passate l\'attività c\'è e la temperatura dell\'acqua conta', () => {
  const date = '2026-07-10'
  const mk = h => ({ date, hour: h, time: `${date}T${String(h).padStart(2, '0')}:00`, windSpeed: 8, pressure: 1015 - h * 0.1 })
  const all = Array.from({ length: 24 }, (_, h) => mk(h))
  const marineHours = all.map(r => ({ time: r.time, seaTemp: 20 }))
  const base = { date, marineHours, sunrise: `${date}T05:40`, sunset: `${date}T20:30`, moonIllumination: 0.5 }
  // solo le ultime 4 ore (come prima del fix): nessuna stima
  assert.equal(activityForDay({ ...base, hourly: all.slice(20) }), null)
  // con le ore dalla mezzanotte: stima completa, con temperatura dell'acqua
  const a = activityForDay({ ...base, hourly: all })
  assert.ok(a && a.hours.length === 24 && a.partial === false)
  assert.ok(a.factors.waterTemp && a.factors.waterTemp.score === 1)
})
