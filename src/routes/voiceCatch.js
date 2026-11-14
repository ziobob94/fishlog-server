// Catture a voce nell'uscita in corso. Registrato sotto /api/sessions (v. index.js).
//  POST   /api/sessions/:id/voice-catch            { text, time?, voiceId?, species?, force? }
//  DELETE /api/sessions/:id/catches/:catchId       annulla (usato dal pulsante "Annulla")
import Session from '../models/Session.js'
import { canEdit } from '../utils/sessionAccess.js'
import { getClient, interpretWithFallback, resolveSpecies, normalizeCatch, MAX_TEXT, MAX_CATCHES } from '../utils/voiceCatch.js'

export default async function voiceCatchRoutes(app) {
  const auth = { preHandler: [app.authenticate] }
  const limit = { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }

  app.post('/:id/voice-catch', { ...auth, ...limit }, async (req, reply) => {
    const { text: rawText, time, voiceId, species: forcedSpecies, force } = req.body || {}
    const text = typeof rawText === 'string' ? rawText.trim() : ''
    if (!text) return reply.status(400).send({ error: 'Testo mancante' })
    if (text.length > MAX_TEXT) return reply.status(400).send({ error: `Testo troppo lungo (max ${MAX_TEXT} caratteri)` })
    const vid = typeof voiceId === 'string' && voiceId.length <= 64 ? voiceId : null

    const session = await Session.findById(req.params.id)
    if (!session) return reply.status(404).send({ error: 'Sessione non trovata' })
    if (!canEdit(req.user, session)) return reply.status(403).send({ error: 'Permesso negato' })

    // Invio già elaborato (es. ripetuto dalla coda offline dopo una risposta persa): nessuna nuova chiamata all'AI.
    if (vid) {
      const done = session.catches.filter(c => c.voiceId?.startsWith(vid + ':'))
      if (done.length) return { results: done.map(c => ({ status: 'saved', catch: c })), duplicate: true }
    }

    const client = getClient()
    if (!client) return reply.status(503).send({ error: 'Catture a voce non disponibili: chiave AI non configurata' })

    let out
    try {
      out = await interpretWithFallback(client, text, { time })
    } catch (err) {
      req.log.error({ err: err?.message, status: err?.status }, 'voice-catch: errore AI')
      return reply.status(502).send({ error: 'Servizio di interpretazione non raggiungibile, riprova' })
    }
    if (!out.raw.length) {
      return { results: [{ status: 'needs_info', reason: 'not_understood', question: out.reply || 'Non ho capito quale pesce hai preso. Puoi ripetere?' }], model: out.model }
    }

    const results = []
    const toSave = []
    for (const [i, raw] of out.raw.slice(0, MAX_CATCHES).entries()) {
      const asked = (i === 0 && forcedSpecies ? String(forcedSpecies) : String(raw.specie || '')).trim()
      const sp = await resolveSpecies(asked)
      let name = sp.name
      if (!name && force && asked.length >= 2) name = asked.slice(0, 80) // «Usa comunque»: scelta esplicita dell'utente
      if (!name) {
        results.push({
          status: 'needs_info', reason: 'species_unknown', asked, candidates: sp.candidates,
          question: sp.candidates?.length ? `Quale di questi intendevi per «${asked}»?` : `Non conosco la specie «${asked}». Vuoi usarla comunque?`
        })
        continue
      }
      const { fields, warnings, toComplete } = normalizeCatch(raw, { defaultTime: time })
      const subdoc = { species: name, ...fields, ...(toComplete ? { toComplete: true } : {}), ...(vid ? { voiceId: `${vid}:${i}` } : {}) }
      toSave.push({ i, subdoc, extra: { warnings, ...(sp.matchedAlias ? { matchedAlias: sp.matchedAlias } : {}) } })
      results.push(null) // segnaposto, riempito dopo il salvataggio
    }

    if (toSave.length) {
      const before = session.catches.length
      for (const t of toSave) session.catches.push(t.subdoc)
      await session.save()
      toSave.forEach((t, k) => {
        const idx = results.findIndex(r => r === null)
        results[idx] = { status: 'saved', catch: session.catches[before + k], ...t.extra }
      })
    }
    return { results, model: out.model, escalated: !!out.escalated }
  })

  app.delete('/:id/catches/:catchId', auth, async (req, reply) => {
    const session = await Session.findById(req.params.id)
    if (!session) return reply.status(404).send({ error: 'Sessione non trovata' })
    if (!canEdit(req.user, session)) return reply.status(403).send({ error: 'Permesso negato' })
    const c = session.catches.id(req.params.catchId)
    if (!c) return reply.status(404).send({ error: 'Cattura non trovata' })
    c.deleteOne()
    await session.save()
    return { deleted: true, id: req.params.catchId }
  })
}
