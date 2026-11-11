import Notification from '../models/Notification.js'
import Friendship from '../models/Friendship.js'

// Elimina le notifiche "richiesta d'amicizia" già gestite (accettate, rifiutate,
// annullate): restavano con Accetta/Rifiuta anche dopo la risposta.
async function purgeStaleFriendRequests(userId) {
  const rows = await Notification.find({ recipient: userId, type: 'friend_request' }).select('data').lean()
  if (!rows.length) return
  const ids = rows.map(r => r.data?.requestId).filter(Boolean)
  const pending = await Friendship.find({ _id: { $in: ids }, status: 'pending' }).select('_id').lean()
  const pendingSet = new Set(pending.map(p => p._id.toString()))
  const stale = rows.filter(r => !r.data?.requestId || !pendingSet.has(r.data.requestId.toString())).map(r => r._id)
  if (stale.length) await Notification.deleteMany({ _id: { $in: stale } })
}

const PUBLIC_FIELDS = 'displayName email avatar'

export default async function notificationRoutes(app) {

  const auth = { preHandler: [app.authenticate] }

  // GET /api/notifications — le mie notifiche, più recenti prima
  app.get('/', auth, async (req) => {
    await purgeStaleFriendRequests(req.user.sub)
    const notifications = await Notification.find({ recipient: req.user.sub })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate('actor', PUBLIC_FIELDS)
      .lean()
    return { data: notifications }
  })

  // GET /api/notifications/unread-count
  app.get('/unread-count', auth, async (req) => {
    await purgeStaleFriendRequests(req.user.sub)
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
