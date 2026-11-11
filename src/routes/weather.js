import { getCurrent, getDay, googleKey } from '../utils/weather.js'
import { getOverview } from '../utils/weatherPanel.js'
import { fishingForDay, userSpeciesCounts, rulesOverride } from '../utils/fishingDay.js'
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

  app.get('/overview', auth, overview)
  app.get('/', auth, overview)
}
