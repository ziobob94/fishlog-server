import Friendship from '../models/Friendship.js'
import Group from '../models/Group.js'
import User from '../models/User.js'
import Notification from '../models/Notification.js'
import { sendMail, friendRequestEmail } from '../utils/mailer.js'
import { sendToUser } from '../ws/hub.js'
import AppConfig from '../config.js'

const cfg = new AppConfig()
const CLIENT_URL = cfg.get('client.url')

const PUBLIC_FIELDS = 'displayName email avatar'

// Recupera l'eventuale riga di amicizia/richiesta tra due utenti, in
// qualsiasi direzione sia stata creata (A→B o B→A).
function findBetween(userA, userB) {
  return Friendship.findOne({
    $or: [
      { requester: userA, recipient: userB },
      { requester: userB, recipient: userA }
    ]
  })
}

// Persiste una notifica e la spinge in realtime al destinatario, se connesso.
async function notify(recipientId, type, actorId, data) {
  const notification = await new Notification({ recipient: recipientId, type, actor: actorId, data }).save()
  sendToUser(recipientId, { type: 'notification', payload: notification })
}

async function commonGroupIds(userA, userB) {
  const [groupsA, groupsB] = await Promise.all([
    Group.find({ members: userA }).select('_id').lean(),
    Group.find({ members: userB }).select('_id').lean()
  ])
  const idsB = new Set(groupsB.map(g => g._id.toString()))
  return groupsA.filter(g => idsB.has(g._id.toString())).map(g => g._id)
}

export default async function friendRoutes(app) {

  const auth = { preHandler: [app.authenticate] }

  // GET /api/friends — i miei amici (richieste accettate)
  app.get('/', auth, async (req) => {
    const userId = req.user.sub
    const rows = await Friendship.find({
      status: 'accepted',
      $or: [{ requester: userId }, { recipient: userId }]
    }).populate('requester', PUBLIC_FIELDS).populate('recipient', PUBLIC_FIELDS).lean()

    // requester/recipient possono risultare null se l'altro utente è stato
    // eliminato nel frattempo (dati storici da prima della pulizia in fase
    // di cancellazione account): li scartiamo per non rompere il frontend.
    const friends = rows
      .filter(r => r.requester && r.recipient)
      .map(r => (r.requester._id.toString() === userId ? r.recipient : r.requester))
    return { data: friends }
  })

  // GET /api/friends/requests — richieste in arrivo e inviate, in attesa
  app.get('/requests', auth, async (req) => {
    const userId = req.user.sub
    const [received, sent] = await Promise.all([
      Friendship.find({ recipient: userId, status: 'pending' }).populate('requester', PUBLIC_FIELDS).lean(),
      Friendship.find({ requester: userId, status: 'pending' }).populate('recipient', PUBLIC_FIELDS).lean()
    ])
    // vedi commento in GET / sui riferimenti orfani da utenti eliminati
    return {
      received: received.filter(r => r.requester),
      sent: sent.filter(r => r.recipient)
    }
  })

  // GET /api/friends/:userId/status — 'none' | 'friends' | 'sent' | 'received'
  app.get('/:userId/status', auth, async (req, reply) => {
    const userId = req.user.sub
    const other = req.params.userId
    if (other === userId) return reply.status(400).send({ error: 'Non puoi controllare lo stato con te stesso' })

    const row = await findBetween(userId, other)
    if (!row) return { status: 'none' }
    if (row.status === 'accepted') return { status: 'friends', requestId: row._id }
    return { status: row.requester.toString() === userId ? 'sent' : 'received', requestId: row._id }
  })

  // GET /api/friends/:userId/common-groups — gruppi in comune con un altro utente
  app.get('/:userId/common-groups', auth, async (req) => {
    const ids = await commonGroupIds(req.user.sub, req.params.userId)
    const groups = await Group.find({ _id: { $in: ids } }).select('name').lean()
    return { data: groups }
  })

  // POST /api/friends/requests — invia una richiesta d'amicizia
  app.post('/requests', auth, async (req, reply) => {
    const userId = req.user.sub
    const { userId: toUserId } = req.body
    if (!toUserId) return reply.status(400).send({ error: 'userId obbligatorio' })
    if (toUserId === userId) return reply.status(400).send({ error: 'Non puoi inviare una richiesta a te stesso' })

    const target = await User.findById(toUserId).select('_id email notificationPreferences').lean()
    if (!target) return reply.status(404).send({ error: 'Utente non trovato' })

    const existing = await findBetween(userId, toUserId)
    if (existing) return reply.status(409).send({ error: 'Richiesta già esistente o già amici' })

    const request = await new Friendship({ requester: userId, recipient: toUserId }).save()

    notify(toUserId, 'friend_request', userId, { requestId: request._id })
      .catch(err => app.log.error(err, 'Creazione notifica richiesta amicizia fallita'))

    if (target.email && target.notificationPreferences?.emailFriendRequests !== false) {
      sendMail({ to: target.email, ...friendRequestEmail(req.user.name, `${CLIENT_URL}/friends`) })
        .catch(err => app.log.error(err, 'Invio email richiesta amicizia fallito'))
    }

    return reply.status(201).send(request)
  })

  // POST /api/friends/requests/:id/accept — il destinatario accetta
  app.post('/requests/:id/accept', auth, async (req, reply) => {
    const request = await Friendship.findById(req.params.id)
    if (!request) return reply.status(404).send({ error: 'Richiesta non trovata' })
    if (request.recipient.toString() !== req.user.sub) return reply.status(403).send({ error: 'Permesso negato' })
    if (request.status !== 'pending') return reply.status(400).send({ error: 'Richiesta già gestita' })

    request.status = 'accepted'
    await request.save()

    notify(request.requester, 'friend_accept', req.user.sub, { requestId: request._id })
      .catch(err => app.log.error(err, 'Creazione notifica accettazione amicizia fallita'))

    return request
  })

  // DELETE /api/friends/requests/:id — rifiuta (destinatario) o annulla (mittente) una richiesta pendente
  app.delete('/requests/:id', auth, async (req, reply) => {
    const request = await Friendship.findById(req.params.id)
    if (!request) return reply.status(404).send({ error: 'Richiesta non trovata' })
    const userId = req.user.sub
    if (request.requester.toString() !== userId && request.recipient.toString() !== userId)
      return reply.status(403).send({ error: 'Permesso negato' })

    await request.deleteOne()
    return { deleted: true }
  })

  // DELETE /api/friends/:userId — rimuove un'amicizia esistente
  app.delete('/:userId', auth, async (req, reply) => {
    const row = await findBetween(req.user.sub, req.params.userId)
    if (!row || row.status !== 'accepted') return reply.status(404).send({ error: 'Amicizia non trovata' })

    await row.deleteOne()
    return { deleted: true }
  })
}
