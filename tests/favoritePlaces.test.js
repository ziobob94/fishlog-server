import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeFavorites, sortedFavorites, summarizeForCard, MAX_FAVORITE_PLACES } from '../src/utils/favoritePlaces.js'

const p = (i, extra = {}) => ({ id: `p${i}`, name: `Posto ${i}`, lat: 40 + i / 10, lon: 10 + i / 10, ...extra })

test('rinumera order secondo l\'ordine dell\'array', () => {
  const r = normalizeFavorites([p(2), p(0), p(1)])
  assert.equal(r.ok, true)
  assert.deepEqual(r.places.map(x => [x.id, x.order]), [['p2', 0], ['p0', 1], ['p1', 2]])
})
test('limite di 8 località', () => {
  assert.equal(MAX_FAVORITE_PLACES, 8)
  assert.equal(normalizeFavorites(Array.from({ length: 8 }, (_, i) => p(i))).ok, true)
  assert.equal(normalizeFavorites(Array.from({ length: 9 }, (_, i) => p(i))).ok, false)
})
test('rifiuta coordinate, nomi e id non validi o duplicati', () => {
  assert.equal(normalizeFavorites([p(1, { lat: 91 })]).ok, false)
  assert.equal(normalizeFavorites([p(1, { name: ' ' })]).ok, false)
  assert.equal(normalizeFavorites([p(1), p(1)]).ok, false)
  assert.equal(normalizeFavorites('x').ok, false)
  assert.deepEqual(normalizeFavorites([]), { ok: true, places: [] })
})
test('sortedFavorites ordina per order', () => {
  assert.deepEqual(sortedFavorites([{ ...p(1), order: 1 }, { ...p(0), order: 0 }]).map(x => x.id), ['p0', 'p1'])
})
test('summarizeForCard: onda assente per località interne', () => {
  const base = { current: { temp: 18, wmo: 1, isDay: true, windSpeed: 12, windDeg: 90 }, updatedAt: 'x' }
  assert.equal(summarizeForCard({ ...base, marine: { available: true, waveHeight: 0.6 } }).waveHeight, 0.6)
  const inland = summarizeForCard({ ...base, marine: { available: false, waveHeight: null } })
  assert.equal(inland.waveHeight, null); assert.equal(inland.hasSea, false)
})
