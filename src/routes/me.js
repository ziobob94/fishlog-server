import User from '../models/User.js'
import { normalizeFavorites, sortedFavorites } from '../utils/favoritePlaces.js'

// Dati personali dell'account. Prefisso /api/me.
export default async function meRoutes(app) {
  const auth = { preHandler: [app.authenticate] }

  // GET /api/me/favorite-places — località preferite, in ordine
  app.get('/favorite-places', auth, async (req) => {
    const u = await User.findById(req.user.sub).select('favoritePlaces').lean()
    return { places: sortedFavorites(u?.favoritePlaces) }
  })

  // PUT /api/me/favorite-places — sostituisce la lista intera (ordine = ordine dell'array, max 8)
  app.put('/favorite-places', { ...auth, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const r = normalizeFavorites(req.body?.places ?? req.body)
    if (!r.ok) return reply.status(400).send({ error: r.error })
    await User.updateOne({ _id: req.user.sub }, { $set: { favoritePlaces: r.places } })
    return { places: r.places }
  })
}
