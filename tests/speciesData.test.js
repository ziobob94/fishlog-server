import test from 'node:test'
import assert from 'node:assert/strict'
import { ITALIAN_SPECIES } from '../scripts/data/italianSpecies.js'
import { DESCRIPTIONS } from '../scripts/data/italianSpeciesDescriptions.js'

test('ogni specie curata ha descrizione, nome italiano e acqua valida', () => {
  for (const [sci, it, aliases, water] of ITALIAN_SPECIES) {
    assert.ok(DESCRIPTIONS[sci] && DESCRIPTIONS[sci].length > 40, `descrizione mancante: ${sci}`)
    assert.ok(it, `nome italiano mancante: ${sci}`)
    assert.ok(Array.isArray(aliases))
    assert.ok(['mare', 'dolce', 'misto'].includes(water), `acqua non valida: ${sci}`)
  }
})
test('nessun nome scientifico duplicato e nessuna descrizione orfana', () => {
  const names = ITALIAN_SPECIES.map(r => r[0])
  assert.equal(new Set(names).size, names.length)
  for (const k of Object.keys(DESCRIPTIONS)) assert.ok(names.includes(k), `descrizione orfana: ${k}`)
})
