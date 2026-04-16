import User from '../models/User.js'
import Session from '../models/Session.js'

export default async function adminRoutes(app) {

  const adminOnly = { preHandler: [app.requireRole('admin')] }
  const modOrAdmin = { preHandler: [app.requireRole('admin', 'moderator')] }

  // GET /api/admin/users
  app.get('/users', adminOnly, async (req) => {
    const { page = 1, limit = 30, search } = req.query
    const filter = search
      ? { $or: [{ email: new RegExp(search, 'i') }, { displayName: new RegExp(search, 'i') }] }
      : {}

    const [users, total] = await Promise.all([
      User.find(filter).select('-passwordHash').sort({ createdAt: -1 })
        .skip((parseInt(page) - 1) * parseInt(limit)).limit(parseInt(limit)).lean(),
      User.countDocuments(filter)
    ])
    return { data: users, pagination: { page: parseInt(page), total, pages: Math.ceil(total / parseInt(limit)) } }
  })

  // PATCH /api/admin/users/:id/role
  app.patch('/users/:id/role', adminOnly, async (req, reply) => {
    const { role } = req.body
    if (!['user', 'moderator', 'admin'].includes(role))
      return reply.status(400).send({ error: 'Ruolo non valido' })
    if (req.params.id === req.user.sub)
      return reply.status(400).send({ error: 'Non puoi cambiare il tuo ruolo' })

    const user = await User.findByIdAndUpdate(req.params.id, { role }, { new: true }).select('-passwordHash')
    if (!user) return reply.status(404).send({ error: 'Utente non trovato' })
    return user
  })

  // DELETE /api/admin/users/:id
  app.delete('/users/:id', adminOnly, async (req, reply) => {
    if (req.params.id === req.user.sub)
      return reply.status(400).send({ error: 'Non puoi eliminare te stesso' })

    await User.findByIdAndDelete(req.params.id)
    await Session.deleteMany({ userId: req.params.id })
    return { deleted: true }
  })

  // GET /api/admin/sessions — tutte le sessioni
  app.get('/sessions', modOrAdmin, async (req) => {
    const { page = 1, limit = 30, userId, hidden } = req.query
    const filter = {}
    if (userId) filter.userId = userId
    if (hidden !== undefined) filter.hidden = hidden === 'true'

    const [sessions, total] = await Promise.all([
      Session.find(filter).sort({ date: -1 })
        .skip((parseInt(page) - 1) * parseInt(limit)).limit(parseInt(limit))
        .populate('userId', 'displayName email').lean(),
      Session.countDocuments(filter)
    ])
    return { data: sessions, pagination: { page: parseInt(page), total, pages: Math.ceil(total / parseInt(limit)) } }
  })
}