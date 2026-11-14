import test from 'node:test'
import assert from 'node:assert/strict'

const { default: Session } = await import('../src/models/Session.js')
const { default: Species } = await import('../src/models/Species.js')
const { default: assistantRoutes } = await import('../src/routes/assistant.js')
const { resetCooldown } = await import('../src/utils/voiceProviders.js')

// Senza database: si sostituiscono find/save dei modelli con versioni in memoria.
let store = []
Session.findOne = async (q) => store.find(s => String(s.userId) === String(q.userId) && (q.status ? s.status === q.status : true) && (!q.$or || q.$or.some(c => Object.values(c).some(re => (re.test ? [s.voiceId, ...s.catches.map(k => k.voiceId)].some(v => v && re.test(v)) : false))))) || null
Session.prototype.save = async function () { if (!store.includes(this)) store.push(this); return this }
const CATALOG = [{ commonNameIt: 'Spigola', aliasesIt: ['Branzino'], scientificName: 'Dicentrarchus labrax' }, { commonNameIt: 'Orata', scientificName: 'Sparus aurata' }]
Species.find = (q) => ({ limit: () => ({ lean: async () => CATALOG.filter(s => q.$or.some(c => Object.entries(c).some(([k, re]) => [].concat(s[k] || []).some(v => re.test(v))))) }) })

let handler
await assistantRoutes({ authenticate: () => {}, post: (path, opts, h) => { handler = h } })
const call = async (body, user = '64b7f0f0f0f0f0f0f0f0f0a1') => {
  const res = { code: 200, headers: {}, status(c) { this.code = c; return this }, header(k, v) { this.headers[k] = v }, send(b) { this.body = b; return this } }
  const out = await handler({ body, user: { sub: user }, log: { warn() {} } }, res)
  return { status: res.code, ...(res.body ?? out) }
}
const noKeys = () => { delete process.env.GEMINI_API_KEY; delete process.env.ANTHROPIC_API_KEY; delete process.env.VOICE_AI_PROVIDER }
const fresh = () => { store = []; resetCooldown(); noKeys() }

test('senza uscita: «inizio un\'uscita a Civitavecchia, canna da fondo» la crea (regole)', async () => {
  fresh()
  const r = await call({ text: "Inizio un'uscita a Civitavecchia, canna da fondo", time: '07:30' })
  assert.equal(r.degraded, 'no_provider')
  assert.equal(r.results[0].action, 'start_session'); assert.equal(r.results[0].status, 'saved')
  const s = store[0]
  assert.equal(s.location.name, 'Civitavecchia'); assert.equal(s.status, 'ongoing'); assert.equal(s.startTime, '07:30'); assert.equal(s.technique, 'altro')
})
test('seconda richiesta di inizio: già in corso, nessuna nuova uscita', async () => {
  fresh(); await call({ text: 'inizio un\'uscita a Ostia' })
  const r = await call({ text: 'inizio un\'uscita a Fiumicino' })
  assert.equal(store.length, 1); assert.equal(r.results[0].reason, 'already_ongoing')
})
test('cambio esca, poi catture senza esca ereditano l\'esca in uso', async () => {
  fresh(); await call({ text: 'inizio un\'uscita a Ostia' })
  const b = await call({ text: 'cambio esca, ora uso il gambero' })
  assert.equal(b.results[0].action, 'change_bait'); assert.equal(store[0].currentBait, 'gambero')
  const c = await call({ text: 'ho preso un branzino da 2 chili', time: '09:00' })
  const saved = c.results.find(x => x.action === 'catch')
  assert.equal(saved.status, 'saved'); assert.equal(saved.catch.species, 'Spigola'); assert.equal(saved.catch.baitUsed, 'gambero'); assert.equal(saved.catch.weightKg, 2)
})
test('cattura senza uscita: Fishy ne avvia una e lo dice', async () => {
  fresh()
  const r = await call({ text: 'ho preso un\'orata da 1 chilo', time: '10:00' })
  assert.deepEqual(r.results.map(x => x.action), ['start_session', 'catch'])
  assert.equal(r.results[0].auto, true); assert.equal(store.length, 1); assert.equal(store[0].catches.length, 1)
})
test('fine uscita chiude con l\'ora; senza uscita risponde info', async () => {
  fresh()
  assert.equal((await call({ text: 'ho finito l\'uscita' })).results[0].reason, 'no_session')
  await call({ text: 'inizio un\'uscita a Ostia', time: '06:00' })
  const r = await call({ text: 'ho finito l\'uscita', time: '12:15' })
  assert.equal(r.results[0].action, 'end_session'); assert.equal(store[0].status, 'closed'); assert.equal(store[0].endTime, '12:15')
})
test('idempotenza: stessa dettatura (voiceId) non crea doppioni', async () => {
  fresh()
  await call({ text: 'inizio un\'uscita a Ostia', voiceId: 'v1' })
  const again = await call({ text: 'inizio un\'uscita a Ostia', voiceId: 'v1' })
  assert.equal(store.length, 1); assert.equal(again.duplicate, true)
})
test('Gemini: una frase = inizia uscita + cattura, in ordine', async () => {
  fresh(); process.env.GEMINI_API_KEY = 'K'
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ candidates: [{ content: { parts: [
    { functionCall: { name: 'inizia_uscita', args: { luogo: 'Civitavecchia', tecnica: 'spinning' } } },
    { functionCall: { name: 'registra_cattura', args: { specie: 'spigola', peso_kg: 1.5, confidenza: 'alta' } } }] } }] }) })
  try {
    const r = await call({ text: 'inizio a Civitavecchia a spinning e ho preso una spigola di un chilo e mezzo', time: '08:00' })
    assert.deepEqual(r.results.map(x => x.action), ['start_session', 'catch']); assert.equal(r.provider, 'gemini')
    assert.equal(store[0].technique, 'spinning'); assert.equal(store[0].catches[0].weightKg, 1.5)
  } finally { globalThis.fetch = realFetch; noKeys() }
})
test('Gemini 429 e frase non capibile a regole: 429 con code e retryAfter', async () => {
  fresh(); process.env.GEMINI_API_KEY = 'K'
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => ({ ok: false, status: 429, headers: { get: () => null }, json: async () => ({ error: { message: 'quota', details: [{ retryDelay: '20s' }] } }) })
  try {
    const r = await call({ text: 'che tempo farà domani sul molo?' })
    assert.equal(r.status, 429); assert.equal(r.code, 'ai_rate_limit'); assert.equal(r.retryAfter, 20)
  } finally { globalThis.fetch = realFetch; noKeys(); resetCooldown() }
})
