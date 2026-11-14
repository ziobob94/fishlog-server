// Catture a voce nell'uscita in corso. Registrato sotto /api/sessions (v. index.js).
//  POST   /api/sessions/:id/voice-catch            { text, time?, voiceId?, species?, force? }
//  DELETE /api/sessions/:id/catches/:catchId       annulla (usato dal pulsante "Annulla")
import Session from '../models/Session.js'
import { canEdit } from '../utils/sessionAccess.js'
import { interpretWithFallback, resolveSpecies, normalizeCatch, MAX_TEXT, MAX_CATCHES } from '../utils/voiceCatch.js'
import { activeProvider, VoiceAiError, inCooldown, cooldownLeft, startCooldown } from '../utils/voiceProviders.js'
import { parseWithRules } from '../utils/voiceRules.js'

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

    // Fornitore AI (Gemini gratuito di default). Se è al limite (429), non raggiungibile o non configurato si ripiega
    // sul parser a regole (una cattura semplice per frase); se nemmeno quello capisce, errore con `code` e
    // `retryAfter`: il client mette la frase in coda e riprova.
    const provider = activeProvider()
    let out
    let degraded = null
    let retryAfter
    if (!provider) degraded = 'no_provider'
    else if (inCooldown()) { degraded = 'rate_limit'; retryAfter = cooldownLeft() }
    else {
      try {
        out = await interpretWithFallback(provider, text, { time })
      } catch (err) {
        const code = err instanceof VoiceAiError ? err.code : 'unavailable'
        req.log.warn({ provider: provider.name, code, status: err?.status, err: err?.message }, 'voice-catch: errore AI')
        degraded = code
        if (code === 'rate_limit') { startCooldown(err.retryAfter); retryAfter = err.retryAfter || cooldownLeft() }
      }
    }
    if (degraded) {
      out = await parseWithRules(text)
      if (!out.raw.length) {
        const msg = {
          rate_limit: `Il servizio AI ha raggiunto il limite di richieste${retryAfter ? `: riprova tra circa ${retryAfter} s` : ''}.`,
          auth: 'La chiave del servizio AI non è valida: avvisa l\'amministratore.',
          no_provider: 'Le catture a voce non sono configurate: manca la chiave del servizio AI.',
          unavailable: 'Il servizio AI non è raggiungibile al momento, riprova.',
          bad_response: 'Il servizio AI ha dato una risposta non valida, riprova.'
        }[degraded] || 'Servizio AI non disponibile.'
        const status = degraded === 'rate_limit' ? 429 : 503
        const code = degraded === 'rate_limit' ? 'ai_rate_limit' : degraded === 'unavailable' ? 'ai_unavailable' : 'ai_not_configured'
        if (retryAfter) reply.header('retry-after', String(retryAfter))
        return reply.status(status).send({ error: msg, code, ...(retryAfter ? { retryAfter } : {}) })
      }
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
    return { results, model: out.model, provider: provider?.name || null, escalated: !!out.escalated, ...(degraded ? { degraded } : {}) }
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
