import Session from '../models/Session.js'
import { visibilityFilter, canEdit, canModerate } from '../utils/sessionAccess.js'

export default async function sessionRoutes(app) {

  const auth = { preHandler: [app.authenticate] }

  // GET /api/sessions
  app.get('/', auth, async (req) => {
    const { page = 1, limit = 20, technique, location, dateFrom, dateTo, search } = req.query
    const filter = await visibilityFilter(req.user)

    if (technique) filter.technique = technique
    if (location)  filter['location.name'] = new RegExp(location, 'i')
    if (dateFrom || dateTo) {
      filter.date = {}
      if (dateFrom) filter.date.$gte = new Date(dateFrom)
      if (dateTo)   filter.date.$lte = new Date(dateTo)
    }
    if (search) {
      filter.$or = [
        { title: new RegExp(search, 'i') },
        { notes: new RegExp(search, 'i') },
        { 'location.name': new RegExp(search, 'i') },
        { 'location.spot': new RegExp(search, 'i') }
      ]
    }

    const skip = (parseInt(page) - 1) * parseInt(limit)
    const [sessions, total] = await Promise.all([
      Session.find(filter).sort({ date: -1 }).skip(skip).limit(parseInt(limit)).lean(),
      Session.countDocuments(filter)
    ])

    const baseUrl = `${req.protocol}://${req.headers.host}`
    const data = sessions.map(s => ({
      ...s,
      thumbnail: s.media?.[0] ? `${baseUrl}/uploads/${s.media[0].filename}` : null
    }))

    return { data, pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) } }
  })

  // GET /api/sessions/stats
  app.get('/stats', auth, async (req) => {
    const filter = await visibilityFilter(req.user)
    const stats = await Session.aggregate([
      { $match: filter },
      { $group: { _id: null, totalSessions: { $sum: 1 }, totalCatches: { $sum: '$totalCatches' }, avgRating: { $avg: '$rating' } } }
    ])
    return stats[0] || { totalSessions: 0, totalCatches: 0 }
  })

  // GET /api/sessions/:id
  app.get('/:id', auth, async (req, reply) => {
    const filter = await visibilityFilter(req.user)
    const session = await Session.findOne({ _id: req.params.id, ...filter }).lean()
    if (!session) return reply.status(404).send({ error: 'Sessione non trovata o non accessibile' })

    const baseUrl = `${req.protocol}://${req.headers.host}`
    session.media = session.media?.map(m => ({ ...m, url: `${baseUrl}/uploads/${m.filename}` }))
    return session
  })

  // POST /api/sessions
  app.post('/', auth, async (req, reply) => {
    const session = new Session({ ...req.body, userId: req.user.sub })
    await session.save()
    return reply.status(201).send(session)
  })

  // PATCH /api/sessions/:id
  app.patch('/:id', auth, async (req, reply) => {
    const session = await Session.findById(req.params.id)
    if (!session) return reply.status(404).send({ error: 'Sessione non trovata' })
    if (!canEdit(req.user, session)) return reply.status(403).send({ error: 'Permesso negato' })

    // Impedisce di modificare campi riservati
    const { userId, hidden, ...body } = req.body
    Object.assign(session, body)
    await session.save()
    return session
  })

  // DELETE /api/sessions/:id
  app.delete('/:id', auth, async (req, reply) => {
    const session = await Session.findById(req.params.id)
    if (!session) return reply.status(404).send({ error: 'Sessione non trovata' })
    if (!canEdit(req.user, session)) return reply.status(403).send({ error: 'Permesso negato' })

    await session.deleteOne()
    return { deleted: true, id: req.params.id }
  })

  // PATCH /api/sessions/:id/hide — moderator/admin
  app.patch('/:id/hide', auth, async (req, reply) => {
    if (!canModerate(req.user)) return reply.status(403).send({ error: 'Permesso negato' })
    const session = await Session.findByIdAndUpdate(req.params.id, { hidden: req.body.hidden ?? true }, { new: true })
    if (!session) return reply.status(404).send({ error: 'Sessione non trovata' })
    return { hidden: session.hidden }
  })
}