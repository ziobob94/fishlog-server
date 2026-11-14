import test from 'node:test'
import assert from 'node:assert/strict'
const { resolveSpecies, normalizeCatch, interpretWithFallback, TOOL } = await import('../src/utils/voiceCatch.js')
const { geminiCall, VoiceAiError, activeProvider, inCooldown, cooldownLeft, startCooldown, resetCooldown } = await import('../src/utils/voiceProviders.js')
const { extractFields, parseWithRules } = await import('../src/utils/voiceRules.js')

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
const tc = (specie, confidenza = 'alta') => ({ raw: [{ specie, confidenza }], reply: '' })
const provider = (fn) => ({ name: 'x', models: { primary: 'm1', fallback: 'm2' }, call: async (m, t, c) => fn(m, t, c) })

test('modello principale sufficiente: nessun ripiego sul secondo', async () => {
  const calls = []
  const out = await interpretWithFallback(provider(m => { calls.push(m); return tc('orata') }), 'una orata')
  assert.deepEqual(calls, ['m1']); assert.equal(out.raw.length, 1); assert.ok(!out.escalated)
})
test('bassa confidenza: ripiego sul secondo modello', async () => {
  const calls = []
  const out = await interpretWithFallback(provider(m => { calls.push(m); return tc('orata', m === 'm1' ? 'bassa' : 'alta') }), 'boh orata forse')
  assert.deepEqual(calls, ['m1', 'm2']); assert.equal(out.escalated, true)
})
test('nessuno strumento chiamato: ripiego e poi vuoto', async () => {
  const out = await interpretWithFallback(provider(() => ({ raw: [], reply: 'Nessuna cattura.' })), 'che bella giornata')
  assert.equal(out.raw.length, 0)
})
test('errore del primo modello (es. 429) si propaga', async () => {
  await assert.rejects(interpretWithFallback(provider(() => { throw new VoiceAiError('rate_limit', 'x') }), 'orata'), e => e.code === 'rate_limit')
})

// ── Gemini ────────────────────────────────────────────────────────────────────
const fakeFetch = (status, body, headers = {}) => async (url, init) => ({ ok: status < 400, status, headers: { get: k => headers[k] }, json: async () => body, _req: { url, init } })
test('Gemini: richiesta REST corretta e functionCall -> cattura', async () => {
  let req
  const f = async (url, init) => { req = { url, init }; return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ candidates: [{ content: { parts: [{ functionCall: { name: TOOL.name, args: { specie: 'branzino', peso_kg: 2, confidenza: 'alta' } } }] } }] }) } }
  const out = await geminiCall('gemini-3.1-flash-lite', 'un branzino da due chili', { time: '10:00' }, { fetchFn: f, key: 'K' })
  assert.deepEqual(out.raw, [{ specie: 'branzino', peso_kg: 2, confidenza: 'alta' }])
  assert.match(req.url, /models\/gemini-3\.1-flash-lite:generateContent$/)
  assert.equal(req.init.headers['x-goog-api-key'], 'K')
  const body = JSON.parse(req.init.body)
  assert.equal(body.tools[0].functionDeclarations[0].name, TOOL.name)
  assert.equal(body.tools[0].functionDeclarations[0].parameters.additionalProperties, undefined)
  assert.equal(body.toolConfig.functionCallingConfig.mode, 'AUTO')
})
test('Gemini: 429 -> rate_limit con retryAfter dai dettagli', async () => {
  const body = { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'quota', details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '34s' }] } }
  await assert.rejects(geminiCall('m', 'x', {}, { fetchFn: fakeFetch(429, body), key: 'K' }), e => e instanceof VoiceAiError && e.code === 'rate_limit' && e.retryAfter === 34)
})
test('Gemini: chiave errata -> auth; 500 -> unavailable; rete -> unavailable', async () => {
  await assert.rejects(geminiCall('m', 'x', {}, { fetchFn: fakeFetch(400, { error: { message: 'API key not valid' } }), key: 'K' }), e => e.code === 'auth')
  await assert.rejects(geminiCall('m', 'x', {}, { fetchFn: fakeFetch(503, { error: { message: 'overloaded' } }), key: 'K' }), e => e.code === 'unavailable')
  await assert.rejects(geminiCall('m', 'x', {}, { fetchFn: async () => { throw new Error('ECONNRESET') }, key: 'K' }), e => e.code === 'unavailable')
})
test('Gemini: contenuto bloccato -> refused', async () => {
  const out = await geminiCall('m', 'x', {}, { fetchFn: fakeFetch(200, { promptFeedback: { blockReason: 'SAFETY' } }), key: 'K' })
  assert.equal(out.refused, true)
})

// ── Scelta fornitore e cooldown ───────────────────────────────────────────────
test('fornitore: Gemini di default se c\'è la chiave, Anthropic alternativa, nessuno senza chiavi', () => {
  const save = { ...process.env }
  try {
    delete process.env.GEMINI_API_KEY; delete process.env.ANTHROPIC_API_KEY; delete process.env.VOICE_AI_PROVIDER
    assert.equal(activeProvider(), null)
    process.env.ANTHROPIC_API_KEY = 'a'
    assert.equal(activeProvider().name, 'anthropic')
    process.env.GEMINI_API_KEY = 'g'
    const g = activeProvider()
    assert.equal(g.name, 'gemini'); assert.equal(g.models.primary, 'gemini-3.1-flash-lite'); assert.equal(g.models.fallback, 'gemini-3.5-flash')
    process.env.VOICE_AI_PROVIDER = 'anthropic'
    assert.equal(activeProvider().name, 'anthropic')
  } finally { process.env = save }
})
test('cooldown dopo un 429', () => {
  resetCooldown(); assert.equal(inCooldown(), false)
  startCooldown(30); assert.equal(inCooldown(), true); assert.ok(cooldownLeft() <= 30 && cooldownLeft() > 0)
  resetCooldown()
})

// ── Parser a regole ───────────────────────────────────────────────────────────
test('regole: estrae peso, lunghezza, rilascio, ora ed esca', () => {
  assert.deepEqual(extractFields("Ho preso una spigola da 2 chili e mezzo, 55 cm, rilasciata, alle 14:30 con l'arenicola"),
    { peso_kg: 2.5, lunghezza_cm: 55, rilasciato: true, ora: '14:30', esca: 'arenicola' })
  assert.deepEqual(extractFields("un'orata 850 grammi tenuta"), { peso_kg: 0.85, rilasciato: false })
  assert.equal(extractFields('mezzo chilo di sarago').peso_kg, 0.5)
  assert.equal(extractFields('due chili').peso_kg, 2)
})
test('regole: specie dal catalogo (alias) e cattura completa', async () => {
  const out = await parseWithRules('ho preso un branzino da 3 kg rilasciato', { find })
  assert.equal(out.viaRules, true)
  assert.equal(out.raw[0].specie, 'branzino'); assert.equal(out.raw[0].peso_kg, 3); assert.equal(out.raw[0].rilasciato, true)
})
test('regole: nessuna specie riconosciuta -> vuoto', async () => {
  assert.deepEqual((await parseWithRules('che bella giornata oggi', { find })).raw, [])
})
