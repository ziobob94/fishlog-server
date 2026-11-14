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
  const out = await handler({ body, user: { sub: user }, log: { warn() {}, error() {} } }, res)
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

// ── Correzioni dell'uscita in corso e risposte oneste ─────────────────────────
const { resolveClock, romeNow } = await import('../src/utils/clock.js')
test('resolveClock: 4:30 detto alle 15:16 è 04:30, non 14:30/16:30; la fascia vince', () => {
  assert.equal(resolveClock('4:30', { now: '15:16' }), '04:30')
  assert.equal(resolveClock('4:30', { now: '17:00' }), '16:30')
  assert.equal(resolveClock('4:30', { fascia: 'pomeriggio', now: '17:00' }), '16:30')
  assert.equal(resolveClock('6', { fascia: 'sera' }), '18:00')
  assert.equal(resolveClock('16:30', { now: '17:00' }), '16:30')
  assert.equal(resolveClock('99:99'), undefined)
})
test('romeNow: giorno e ora a Roma, non UTC', () => {
  const r = romeNow(new Date('2026-11-14T23:30:00Z')) // a Roma è già il 15 alle 00:30
  assert.equal(r.time, '00:30'); assert.equal(r.date.toISOString(), '2026-11-15T00:00:00.000Z')
})
test('«l\'ho iniziata alle 4:30» modifica davvero l\'ora di inizio (04:30) e offre Annulla', async () => {
  fresh(); await call({ text: 'inizio un\'uscita a Ostia', time: '14:42' })
  const r = await call({ text: "L'uscita l'ho iniziata alle 4:30", time: '15:16' })
  const u = r.results[0]
  assert.equal(u.action, 'update_session'); assert.equal(u.status, 'saved')
  assert.equal(store[0].startTime, '04:30'); assert.deepEqual(u.changes, [{ field: 'startTime', label: 'ora di inizio', from: '14:42', to: '04:30' }])
  assert.deepEqual(u.undo, { method: 'PATCH', url: `/sessions/${store[0]._id}`, body: { startTime: '14:42' } })
})
test('«l\'uscita è a Tirrenia bagno Cisa m\'» aggiorna il luogo', async () => {
  fresh(); await call({ text: 'inizio un\'uscita a Ostia' })
  const r = await call({ text: "L'uscita è a Tirrenia bagno Cisa m'" })
  assert.equal(r.results[0].action, 'update_session'); assert.equal(store[0].location.name, 'Tirrenia Bagno Cisa')
  assert.equal(r.results[0].undo.body.location.name, 'Ostia')
})
test('correzioni senza uscita in corso: info, nessun salvataggio', async () => {
  fresh()
  const r = await call({ text: "L'uscita l'ho iniziata alle 4:30" })
  assert.equal(r.results[0].status, 'info'); assert.equal(store.length, 0)
})
test('modello che risponde a parole «ho corretto…» senza strumenti: nessuna azione, mai «saved»', async () => {
  fresh(); process.env.GEMINI_API_KEY = 'K'; await call({ text: 'inizio un\'uscita a Ostia', time: '14:42' })
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ candidates: [{ content: { parts: [{ text: "Ho corretto l'orario di inizio alle 04:30." }] } }] }) })
  try {
    process.env.GEMINI_API_KEY = 'K'
    const r = await call({ text: 'boh fai tu', time: '15:00' })
    assert.ok(!r.results.some(x => x.status === 'saved')); assert.equal(store[0].startTime, '14:42')
    assert.equal(r.results[0].executed, false)
  } finally { globalThis.fetch = realFetch; noKeys() }
})
test('Gemini: modifica_uscita con ora «4:30» detta alle 15:16 salva 04:30', async () => {
  fresh(); process.env.GEMINI_API_KEY = 'K'; store = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ candidates: [{ content: { parts: [{ functionCall: { name: 'modifica_uscita', args: { ora_inizio: '4:30' } } }] } }] }) })
  try {
    noKeys(); await call({ text: 'inizio un\'uscita a Ostia', time: '14:42' }); process.env.GEMINI_API_KEY = 'K'
    const r = await call({ text: 'ho iniziato alle quattro e mezza', time: '15:16' })
    assert.equal(r.results[0].status, 'saved'); assert.equal(store[0].startTime, '04:30')
  } finally { globalThis.fetch = realFetch; noKeys() }
})
test('salvataggio fallito: errore 500 chiaro, nessun «saved»', async () => {
  fresh(); await call({ text: 'inizio un\'uscita a Ostia', time: '14:42' })
  const realSave = Session.prototype.save
  Session.prototype.save = async () => { throw new Error('db down') }
  try {
    const r = await call({ text: "L'uscita l'ho iniziata alle 4:30", time: '15:16' })
    assert.equal(r.status, 500); assert.equal(r.code, 'save_failed'); assert.equal(r.results, undefined)
  } finally { Session.prototype.save = realSave }
})
