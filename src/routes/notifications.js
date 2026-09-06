import Notification from '../models/Notification.js'

const PUBLIC_FIELDS = 'displayName email avatar'

export default async function notificationRoutes(app) {

  const auth = { preHandler: [app.authenticate] }

  // GET /api/notifications — le mie notifiche, più recenti prima
  app.get('/', auth, async (req) => {
    const notifications = await Notification.find({ recipient: req.user.sub })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate('actor', PUBLIC_FIELDS)
      .lean()
    return { data: notifications }
  })

  // GET /api/notifications/unread-count
  app.get('/unread-count', auth, async (req) => {
    const count = await Notification.countDocuments({ recipient: req.user.sub, read: false })
    return { count }
  })

  // PATCH /api/notifications/:id/read
  app.patch('/:id/read', auth, async (req, reply) => {
    const notification = await Notification.findOne({ _id: req.params.id, recipient: req.user.sub })
    if (!notification) return reply.status(404).send({ error: 'Notifica non trovata' })

    notification.read = true
    await notification.save()
    return notification
  })

  // PATCH /api/notifications/read-all
  app.patch('/read-all', auth, async (req) => {
    await Notification.updateMany({ recipient: req.user.sub, read: false }, { read: true })
    return { ok: true }
  })

  // DELETE /api/notifications/:id
  app.delete('/:id', auth, async (req, reply) => {
    const notification = await Notification.findOneAndDelete({ _id: req.params.id, recipient: req.user.sub })
    if (!notification) return reply.status(404).send({ error: 'Notifica non trovata' })
    return { deleted: true }
  })

  // DELETE /api/notifications — svuota tutto il centro notifiche
  app.delete('/', auth, async (req) => {
    await Notification.deleteMany({ recipient: req.user.sub })
    return { deleted: true }
  })
}
