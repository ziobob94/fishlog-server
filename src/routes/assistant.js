// Assistente vocale generico. Registrato sotto /api/assistant (v. index.js).
//  POST /api/assistant   { text, time?, voiceId?, species?, force? }
// Il modello traduce la frase in azioni (inizia uscita, registra cattura, cambia esca, fine uscita) che il server
// esegue subito sull'uscita in corso dell'utente (o su quella appena avviata). Ogni azione si può annullare
// dal client: catture con DELETE /api/sessions/:id/catches/:catchId, uscita avviata con DELETE /api/sessions/:id,
// esca e fine uscita con PATCH /api/sessions/:id.
import Session from '../models/Session.js'
import { resolveSpecies, normalizeCatch, validTime, MAX_TEXT, MAX_CATCHES } from '../utils/voiceCatch.js'
import { runAssistant } from '../utils/voiceAi.js'
import { stateText } from '../utils/assistantTools.js'

const TECHNIQUES = ['surfcasting', 'feeder', 'spinning', 'bolentino', 'mosca', 'altro']
const WATERS = ['mare', 'fiume', 'lago', 'altro']
const clip = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : undefined)
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export default async function assistantRoutes(app) {
  const auth = { preHandler: [app.authenticate] }
  const limit = { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }

  app.post('/', { ...auth, ...limit }, async (req, reply) => {
    const { text: rawText, time, voiceId, species: forcedSpecies, force } = req.body || {}
    const text = typeof rawText === 'string' ? rawText.trim() : ''
    if (!text) return reply.status(400).send({ error: 'Testo mancante' })
    if (text.length > MAX_TEXT) return reply.status(400).send({ error: `Testo troppo lungo (max ${MAX_TEXT} caratteri)` })
    const vid = typeof voiceId === 'string' && voiceId.length <= 64 ? voiceId : null
    const userId = req.user.sub
    const clock = validTime(time) ? time : undefined

    // Invio già elaborato (es. ripetuto dalla coda offline dopo una risposta persa): nessuna nuova azione.
    if (vid) {
      const prefix = new RegExp('^' + escapeRe(vid) + ':')
      const done = await Session.findOne({ userId, $or: [{ voiceId: prefix }, { 'catches.voiceId': prefix }] })
      if (done) {
        const results = []
        if (done.voiceId && prefix.test(done.voiceId)) results.push({ action: 'start_session', status: 'saved', session: sessionSummary(done) })
        for (const c of done.catches.filter(c => c.voiceId && prefix.test(c.voiceId))) results.push({ action: 'catch', status: 'saved', catch: c, sessionId: done._id })
        return { results, duplicate: true }
      }
    }

    let session = await Session.findOne({ userId, status: 'ongoing' })
    const ai = await runAssistant(text, { time: clock, state: stateText(session), log: req.log })
    if (ai.failure) {
      if (ai.failure.retryAfter) reply.header('retry-after', String(ai.failure.retryAfter))
      return reply.status(ai.failure.status).send({ error: ai.failure.error, code: ai.failure.code, ...(ai.failure.retryAfter ? { retryAfter: ai.failure.retryAfter } : {}) })
    }
    const { out } = ai
    if (!out.calls.length) {
      return { results: [{ action: 'none', status: 'needs_info', reason: 'not_understood', question: out.reply || 'Non ho capito cosa vuoi fare. Puoi ripetere?' }], model: out.model }
    }

    const results = []
    const docs = new Set() // uscite modificate da salvare alla fine
    let catchIndex = 0
    let catches = 0

    // Una cattura (o un'esca, o la fine) senza uscita in corso: se ne avvia una e si dice chiaramente.
    const ensureSession = async () => {
      if (session) return session
      session = new Session({ userId, status: 'ongoing', date: new Date(), startTime: clock, location: { name: 'Luogo da completare' }, ...(vid ? { voiceId: `${vid}:s` } : {}) })
      await session.save()
      results.push({ action: 'start_session', status: 'saved', auto: true, session: sessionSummary(session) })
      return session
    }

    for (const call of out.calls) {
      const a = call.args || {}
      if (call.name === 'inizia_uscita') {
        if (session) {
          results.push({ action: 'start_session', status: 'info', reason: 'already_ongoing', message: `Hai già un'uscita in corso a ${session.location?.name || 'un luogo'}.`, session: sessionSummary(session) })
          continue
        }
        const luogo = clip(a.luogo, 120)
        if (!luogo) { results.push({ action: 'start_session', status: 'needs_info', reason: 'place_missing', question: 'Dove stai pescando?' }); continue }
        session = new Session({
          userId, status: 'ongoing', date: new Date(), startTime: clock,
          location: { name: luogo },
          ...(TECHNIQUES.includes(a.tecnica) ? { technique: a.tecnica } : {}),
          ...(WATERS.includes(a.acqua) ? { waterType: a.acqua } : {}),
          ...(clip(a.note, 300) ? { notes: clip(a.note, 300) } : {}),
          ...(vid ? { voiceId: `${vid}:s` } : {})
        })
        await session.save()
        results.push({ action: 'start_session', status: 'saved', session: sessionSummary(session) })
      } else if (call.name === 'registra_cattura') {
        if (catches++ >= MAX_CATCHES) break
        const asked = (catchIndex === 0 && forcedSpecies ? String(forcedSpecies) : String(a.specie || '')).trim()
        const i = catchIndex++
        const sp = await resolveSpecies(asked)
        let name = sp.name
        if (!name && force && asked.length >= 2) name = asked.slice(0, 80) // «Usa comunque»: scelta esplicita dell'utente
        if (!name) {
          results.push({
            action: 'catch', status: 'needs_info', reason: 'species_unknown', asked, candidates: sp.candidates,
            question: sp.candidates?.length ? `Quale di questi intendevi per «${asked}»?` : `Non conosco la specie «${asked}». Vuoi usarla comunque?`
          })
          continue
        }
        await ensureSession()
        const { fields, warnings, toComplete } = normalizeCatch(a, { defaultTime: clock })
        if (!fields.baitUsed && session.currentBait) fields.baitUsed = session.currentBait
        session.catches.push({ species: name, ...fields, ...(toComplete ? { toComplete: true } : {}), ...(vid ? { voiceId: `${vid}:${i}` } : {}) })
        docs.add(session)
        results.push({ action: 'catch', status: 'saved', catch: session.catches[session.catches.length - 1], sessionId: session._id, warnings, ...(sp.matchedAlias ? { matchedAlias: sp.matchedAlias } : {}) })
      } else if (call.name === 'cambia_esca') {
        const esca = clip(a.esca, 80)
        if (!esca) { results.push({ action: 'change_bait', status: 'needs_info', reason: 'bait_missing', question: 'Quale esca stai usando adesso?' }); continue }
        await ensureSession()
        const previous = session.currentBait || ''
        session.currentBait = esca
        docs.add(session)
        results.push({ action: 'change_bait', status: 'saved', bait: esca, previous, sessionId: session._id })
      } else if (call.name === 'fine_uscita') {
        if (!session) { results.push({ action: 'end_session', status: 'info', reason: 'no_session', message: 'Non c\'è nessuna uscita in corso da chiudere.' }); continue }
        const endTime = validTime(a.ora_fine) ? a.ora_fine : clock
        session.status = 'closed'
        if (endTime) session.endTime = endTime
        docs.add(session)
        results.push({ action: 'end_session', status: 'saved', sessionId: session._id, endTime: endTime || '', summary: sessionSummary(session) })
        session = null // azioni successive nella stessa frase non toccano l'uscita chiusa
      }
    }
    await Promise.all([...docs].map(d => d.save()))
    return { results, model: out.model, provider: ai.provider, escalated: !!out.escalated, ...(ai.degraded ? { degraded: ai.degraded } : {}) }
  })
}

function sessionSummary(s) {
  return { _id: s._id, location: s.location?.name, technique: s.technique || '', startTime: s.startTime || '', status: s.status }
}
