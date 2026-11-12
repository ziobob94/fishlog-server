import test from 'node:test'
import assert from 'node:assert/strict'
import { extractHashtags, normalizeTag, isValidTag } from '../src/utils/hashtags.js'

test('estrae tag unici in minuscolo, anche accentati', () => {
  assert.deepEqual(extractHashtags('Che #Spigola oggi! #spigola #pesca_notturna #Perché'), ['spigola', 'pesca_notturna', 'perché'])
})
test('ignora url con ancora, tag dentro parole e numeri puri', () => {
  assert.deepEqual(extractHashtags('vedi https://x.it/a#frammento e a#b e #123 e #'), [])
})
test('tag a inizio testo, dopo punteggiatura e su più testi', () => {
  assert.deepEqual(extractHashtags('#uno, (#due)', 'titolo #tre'), ['uno', 'due', 'tre'])
})
test('tag lunghi oltre 50 caratteri non sono validi, input vuoto ok', () => {
  assert.deepEqual(extractHashtags(undefined, null, ''), [])
  assert.equal(isValidTag('a'.repeat(51)), false)
  assert.equal(normalizeTag('#Surfcasting'), 'surfcasting')
})
