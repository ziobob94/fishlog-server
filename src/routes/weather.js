import { getCurrent, getDay, googleKey } from '../utils/weather.js'

// Meteo lato server: la chiave Google Weather non esce mai dal server.
export default async function weatherRoutes(app) {
  const limit = { config: { rateLimit: { max: 40, timeWindow: '1 minute' } } }
  const auth = { preHandler: [app.authenticate], ...limit }

  const coords = (q) => {
    const lat = Number(q.lat), lng = Number(q.lng)
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
}
