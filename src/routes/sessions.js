import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'
import Session from '../models/Session.js'
import { visibilityFilter, canEdit, canModerate } from '../utils/sessionAccess.js'

// Catalogo di esche note (naturali/artificiali/miste), usato come base di
// suggerimenti finché non c'è storico personale, e per proporre il "tipo"
// quando l'utente sceglie un'esca standard.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BAIT_CATALOG = JSON.parse(readFileSync(path.join(__dirname, '../data/baits.json'), 'utf-8'))

export default async function sessionRoutes(app) {

  const auth = { preHandler: [app.authenticate] }

  // GET /api/sessions/bait-suggestions — esche già usate (storico) + catalogo,
  // per popolare la select-che-è-anche-input (<datalist>) del form.
  app.get('/bait-suggestions', auth, async (req) => {
    const filter = await visibilityFilter(req.user)
    const agg = await Session.aggregate([
      { $match: filter },
      { $unwind: '$catches' },
      { $project: { bait: { $trim: { input: '$catches.baitUsed' } } } },
      { $match: { bait: { $nin: [null, ''] } } },
      // group case-insensitive: "Arenicola" e "arenicola" sono la stessa esca
      { $group: { _id: { $toLower: '$bait' }, count: { $sum: 1 }, sample: { $first: '$bait' } } },
      { $sort: { count: -1 } },
      { $limit: 20 }
    ])

    const fromHistory = agg.map(a => a.sample)
    const seen = new Set(fromHistory.map(b => b.toLowerCase()))
    const catalogNames = BAIT_CATALOG.map(b => b.name).filter(b => !seen.has(b.toLowerCase()))
    return { data: [...fromHistory, ...catalogNames] }
  })

  // GET /api/sessions/bait-catalog — nome + tipo, per auto-compilare "Tipo esca"
  // quando l'utente sceglie (o scrive) un'esca standard del catalogo.
  app.get('/bait-catalog', auth, async () => ({ data: BAIT_CATALOG }))

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

  // GET /api/sessions/ongoing — la pescata in corso dell'utente (al più una), se c'è
  app.get('/ongoing', auth, async (req) => {
    const session = await Session.findOne({ userId: req.user.sub, status: 'ongoing' }).lean()
    return { data: session || null }
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

  // POST /api/sessions — al più una sessione "ongoing" per utente: aprendone
  // una nuova, l'eventuale precedente ancora in corso viene chiusa.
  app.post('/', auth, async (req, reply) => {
    await Session.updateMany({ userId: req.user.sub, status: 'ongoing' }, { status: 'closed' })
    const session = new Session({ ...req.body, userId: req.user.sub, status: 'ongoing' })
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