import test from 'node:test'
import assert from 'node:assert/strict'
process.env.JWT_SECRET ??= 'x'
const { resolveSpecies, normalizeCatch, interpretWithFallback, TOOL } = await import('../src/utils/voiceCatch.js')

const CATALOG = [
  { commonNameIt: 'Spigola', aliasesIt: ['Branzino', 'Ragno'], scientificName: 'Dicentrarchus labrax' },
  { commonNameIt: 'Orata', scientificName: 'Sparus aurata' },
  { commonNameIt: 'Sarago maggiore', scientificName: 'Diplodus sargus' },
  { commonNameIt: 'Sarago pizzuto', scientificName: 'Diplodus puntazzo' }
]
// Finto Species.find: filtra il catalogo con le regex della query
const find = async (q) => CATALOG.filter(s => q.$or.some(c => Object.entries(c).some(([k, re]) =>
  [].concat(s[k] || []).some(v => re.test(v)))))

test('alias risolto sul nome canonico (branzino = spigola)', async () => {
  assert.deepEqual(await resolveSpecies('branzino', { find }), { name: 'Spigola', matchedAlias: 'Branzino' })
})
test('nome canonico esatto, senza alias', async () => {
  assert.deepEqual(await resolveSpecies('Orata', { find }), { name: 'Orata' })
})
test('prefisso ambiguo: candidati, nessuna scelta automatica', async () => {
  assert.deepEqual(await resolveSpecies('sarago', { find }), { candidates: ['Sarago maggiore', 'Sarago pizzuto'] })
})
test('specie sconosciuta: nessun candidato', async () => {
  assert.deepEqual(await resolveSpecies('unicorno', { find }), { candidates: [] })
})
test('normalizza misure e scarta valori assurdi', () => {
  const r = normalizeCatch({ specie: 'x', peso_kg: 2.5, lunghezza_cm: 9000, ora: '14:30', rilasciato: true, esca: ' arenicola ' }, { defaultTime: '10:00' })
  assert.deepEqual(r.fields, { weightKg: 2.5, time: '14:30', released: true, baitUsed: 'arenicola' })
  assert.deepEqual(r.warnings, ['lunghezza'])
  assert.equal(r.toComplete, false)
})
test('senza peso né lunghezza: da completare; ora di default dal client', () => {
  const r = normalizeCatch({ specie: 'orata', ora: '25:99' }, { defaultTime: '09:15' })
  assert.equal(r.toComplete, true)
  assert.equal(r.fields.time, '09:15')
})
test('Haiku sufficiente: nessun ripiego su Sonnet', async () => {
  const calls = []
  const client = { messages: { create: async (p) => { calls.push(p.model); return { stop_reason: 'tool_use', content: [{ type: 'tool_use', name: TOOL.name, input: { specie: 'orata', confidenza: 'alta' } }] } } } }
  const out = await interpretWithFallback(client, 'una orata', {})
  assert.deepEqual(calls, ['claude-haiku-5-5']); assert.equal(out.raw.length, 1); assert.ok(!out.escalated)
})
test('bassa confidenza: ripiego su Sonnet 5.5', async () => {
  const calls = []
  const client = { messages: { create: async (p) => { calls.push(p.model)
    const conf = p.model === 'claude-haiku-5-5' ? 'bassa' : 'alta'
    return { stop_reason: 'tool_use', content: [{ type: 'tool_use', name: TOOL.name, input: { specie: 'orata', confidenza: conf } }] } } } }
  const out = await interpretWithFallback(client, 'boh orata forse', {})
  assert.deepEqual(calls, ['claude-haiku-5-5', 'claude-sonnet-5-5']); assert.equal(out.escalated, true)
})
test('nessuno strumento chiamato: ripiego e poi vuoto', async () => {
  const client = { messages: { create: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Nessuna cattura.' }] }) } }
  const out = await interpretWithFallback(client, 'che bella giornata', {})
  assert.equal(out.raw.length, 0)
})
