import { getCurrent, getDay, googleKey } from '../utils/weather.js'
import { getOverview } from '../utils/weatherPanel.js'
import { fishingForDay, fishingNow, userSpeciesCounts, rulesOverride } from '../utils/fishingDay.js'
import { summarizeForCard, MAX_FAVORITE_PLACES } from '../utils/favoritePlaces.js'
import { loadRules } from '../utils/fishingActivity.js'

// Meteo lato server: la chiave Google Weather non esce mai dal server.
export default async function weatherRoutes(app) {
  const limit = { config: { rateLimit: { max: 40, timeWindow: '1 minute' } } }
  const auth = { preHandler: [app.authenticate], ...limit }

  const coords = (q) => {
    const lat = Number(q.lat), lng = Number(q.lng ?? q.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
    return { lat: Number(lat.toFixed(4)), lng: Number(lng.toFixed(4)) }
  }

  // GET /api/weather/current?lat&lng — condizioni attuali per la Home
  app.get('/current', auth, async (req, reply) => {
    const c = coords(req.query)
    if (!c) return reply.status(400).send({ error: 'Coordinate non valide' })
    return { ...(await getCurrent(c.lat, c.lng)), googleConfigured: !!googleKey() }
  })

  // GET /api/weather/day?lat&lng&date=YYYY-MM-DD&hour=0-23&marine=1 — meteo (e mare) della giornata di un'uscita
  app.get('/day', auth, async (req, reply) => {
    const c = coords(req.query)
    const date = String(req.query.date || '')
    if (!c || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return reply.status(400).send({ error: 'Parametri non validi' })
    const hour = Math.min(23, Math.max(0, parseInt(req.query.hour, 10) || 12))
    return { ...(await getDay(c.lat, c.lng, date, hour, req.query.marine === '1' || req.query.marine === 'true')), googleConfigured: !!googleKey() }
  })

  // GET /api/weather/overview?lat&lng — pannello completo: attuale + 48 h + 7 giorni + mare + dati utili alla pesca
  // Alias GET /api/weather?lat&lon (nome usato nell'handoff di Design); accetta sia lng sia lon.
  const overview = async (req, reply) => {
    const c = coords(req.query)
    if (!c) return reply.status(400).send({ error: 'Coordinate non valide' })
    try { return await getOverview(c.lat, c.lng) }
    catch (e) { return reply.status(e.status === 502 ? 502 : 500).send({ error: 'Meteo non disponibile, riprova tra poco' }) }
  }
  // GET /api/weather/fishing?lat&lng&date=YYYY-MM-DD — attività dei pesci (stima indicativa) e specie probabili per un giorno.
  // Entro 7 giorni: attività oraria, finestre, fattori e specie da condizioni; oltre: solo specie per stagione (activity: null).
  // Lo storico delle catture dell'utente nel luogo (raggio da fishing.rules.species.userHistory.radiusKm) pesa sulle specie.
  app.get('/fishing', auth, async (req, reply) => {
    const c = coords(req.query)
    const date = String(req.query.date || '')
    if (!c || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return reply.status(400).send({ error: 'Parametri non validi' })
    try {
      const view = await getOverview(c.lat, c.lng)
      const radius = loadRules(rulesOverride()).species.userHistory.radiusKm
      const counts = await userSpeciesCounts(req.user.sub, c.lat, c.lng, radius).catch(() => new Map())
      const out = fishingForDay(view, date, counts)
      if (!out) return reply.status(404).send({ error: 'Giorno fuori dalla previsione' })
      return out
    } catch (e) { return reply.status(e.status === 502 ? 502 : 500).send({ error: 'Meteo non disponibile, riprova tra poco' }) }
  })

  // POST /api/weather/batch { places: [{ id, lat, lon }] } — meteo e mare compatti di più luoghi in una chiamata (schede «Le mie località»).
  // Ogni luogo passa da getOverview (griglia 0,05° con cache 15 min), quindi luoghi vicini o richieste ripetute non costano chiamate.
  // Un luogo che fallisce non blocca gli altri: { id, ok: false }.
  app.post('/batch', auth, async (req, reply) => {
    const list = req.body?.places
    if (!Array.isArray(list) || !list.length || list.length > MAX_FAVORITE_PLACES + 1) return reply.status(400).send({ error: 'Parametri non validi' })
    const items = list.map(p => ({ id: String(p?.id ?? ''), c: coords({ lat: p?.lat, lng: p?.lng ?? p?.lon }) }))
    if (items.some(i => !i.id || !i.c)) return reply.status(400).send({ error: 'Coordinate non valide' })
    const results = await Promise.all(items.map(async ({ id, c }) => {
      try { return { id, ok: true, ...summarizeForCard(await getOverview(c.lat, c.lng)) } }
      catch { return { id, ok: false } }
    }))
    reply.header('Cache-Control', 'private, max-age=900')
    return { results, ttlSeconds: 900 }
  })

  // POST /api/weather/activity { places: [{ id, lat, lon }] } — attività dei pesci «adesso» per più luoghi (Home e schede «Le mie località»).
  // Per luogo: { id, ok, level 1-5 | null, factors: [{ key, effect: 'up'|'flat'|'down' }], nextWindow }. level null = dati insufficienti, ok false = luogo non raggiungibile.
  // Stessa logica del dettaglio giorno del Meteo, sullo stesso getOverview (cache 15 min). Stima indicativa: le uscite dell'utente non entrano nel calcolo.
  app.post('/activity', auth, async (req, reply) => {
    const list = req.body?.places
    if (!Array.isArray(list) || !list.length || list.length > MAX_FAVORITE_PLACES + 2) return reply.status(400).send({ error: 'Parametri non validi' })
    const items = list.map(p => ({ id: String(p?.id ?? ''), c: coords({ lat: p?.lat, lng: p?.lng ?? p?.lon }) }))
    if (items.some(i => !i.id || !i.c)) return reply.status(400).send({ error: 'Coordinate non valide' })
    const rules = loadRules(rulesOverride())
    const results = await Promise.all(items.map(async ({ id, c }) => {
      try { const view = await getOverview(c.lat, c.lng); return { id, ok: true, ...fishingNow(view, rules), updatedAt: view.updatedAt } }
      catch { return { id, ok: false } }
    }))
    reply.header('Cache-Control', 'private, max-age=900')
    return { results, ttlSeconds: 900, indicative: true }
  })

  app.get('/overview', auth, overview)
  app.get('/', auth, overview)
}
