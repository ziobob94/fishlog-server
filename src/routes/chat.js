import Conversation from '../models/Conversation.js'
import Message from '../models/Message.js'
import Friendship from '../models/Friendship.js'
import User from '../models/User.js'
import AppConfig from '../config.js'
import { sendMail, newChatMessageEmail } from '../utils/mailer.js'

const cfg = new AppConfig()
const CLIENT_URL = cfg.get('client.url')

const PUBLIC_FIELDS = 'displayName email avatar'

async function areFriends(userA, userB) {
  const row = await Friendship.findOne({
    status: 'accepted',
    $or: [
      { requester: userA, recipient: userB },
      { requester: userB, recipient: userA }
    ]
  }).lean()
  return !!row
}

async function findConversation(userA, userB) {
  return Conversation.findOne({ participants: { $all: [userA, userB], $size: 2 } })
}

function otherParticipant(conversation, userId) {
  return conversation.participants.find(p => p._id.toString() !== userId)
}

// Avvisa il destinatario via email, solo se ha l'email e non l'ha disattivato
// dal profilo (Notifiche). Non blocca la risposta HTTP: va chiamata "fire and forget".
async function notifyNewMessage(message, recipientId) {
  const recipient = await User.findById(recipientId)
  if (!recipient?.email || recipient.notificationPreferences?.emailChatMessages === false) return

  const preview = message.body.length > 200 ? `${message.body.slice(0, 200)}…` : message.body
  await sendMail({
    to: recipient.email,
    ...newChatMessageEmail(message.sender.displayName || 'Un utente', preview, `${CLIENT_URL}/chat`)
  })
}

export default async function chatRoutes(app) {

  const auth = { preHandler: [app.authenticate] }

  // GET /api/chat/conversations — le mie conversazioni, con l'altro utente,
  // l'ultimo messaggio e il conteggio dei non letti
  app.get('/conversations', auth, async (req) => {
    const userId = req.user.sub
    const conversations = await Conversation.find({ participants: userId })
      .sort({ lastMessageAt: -1 })
      .populate('participants', PUBLIC_FIELDS)
      .lean()

    const data = await Promise.all(conversations.map(async (c) => {
      const other = otherParticipant(c, userId)
      const [lastMessage, unreadCount] = await Promise.all([
        Message.findOne({ conversation: c._id }).sort({ createdAt: -1 }).lean(),
        Message.countDocuments({ conversation: c._id, sender: { $ne: userId }, readAt: null })
      ])
      return { _id: c._id, user: other, lastMessage, unreadCount, lastMessageAt: c.lastMessageAt }
    }))

    return { data }
  })

  // GET /api/chat/unread-count — badge icona chat: somma dei non letti su tutte le conversazioni
  app.get('/unread-count', auth, async (req) => {
    const userId = req.user.sub
    const conversations = await Conversation.find({ participants: userId }).select('_id').lean()
    const count = await Message.countDocuments({
      conversation: { $in: conversations.map(c => c._id) },
      sender: { $ne: userId },
      readAt: null
    })
    return { count }
  })

  // GET /api/chat/with/:userId — conversazione con un amico (creata al volo se non esiste)
  app.get('/with/:userId', auth, async (req, reply) => {
    const userId = req.user.sub
    const otherId = req.params.userId
    if (otherId === userId) return reply.status(400).send({ error: 'Non puoi scrivere a te stesso' })
    if (!await areFriends(userId, otherId)) return reply.status(403).send({ error: 'Potete scrivervi solo se siete amici' })

    let conversation = await findConversation(userId, otherId)
    if (!conversation) conversation = await new Conversation({ participants: [userId, otherId] }).save()

    return { _id: conversation._id }
  })

  // GET /api/chat/:conversationId/messages — cronologia (solo partecipanti)
  app.get('/:conversationId/messages', auth, async (req, reply) => {
    const conversation = await Conversation.findById(req.params.conversationId)
    if (!conversation) return reply.status(404).send({ error: 'Conversazione non trovata' })
    if (!conversation.participants.some(p => p.toString() === req.user.sub))
      return reply.status(403).send({ error: 'Permesso negato' })

    const messages = await Message.find({ conversation: conversation._id })
      .sort({ createdAt: 1 })
      .populate('sender', PUBLIC_FIELDS)
      .lean()

    return { data: messages }
  })

  // POST /api/chat/with/:userId/messages — invia un messaggio (crea la conversazione se serve)
  app.post('/with/:userId/messages', auth, async (req, reply) => {
    const userId = req.user.sub
    const otherId = req.params.userId
    if (otherId === userId) return reply.status(400).send({ error: 'Non puoi scrivere a te stesso' })
    if (!await areFriends(userId, otherId)) return reply.status(403).send({ error: 'Potete scrivervi solo se siete amici' })

    const { body } = req.body
    if (!body?.trim()) return reply.status(400).send({ error: 'Messaggio obbligatorio' })

    let conversation = await findConversation(userId, otherId)
    if (!conversation) conversation = await new Conversation({ participants: [userId, otherId] }).save()

    const message = await new Message({ conversation: conversation._id, sender: userId, body: body.trim() }).save()
    conversation.lastMessageAt = message.createdAt
    await conversation.save()
    await message.populate('sender', PUBLIC_FIELDS)

    notifyNewMessage(message, otherId).catch(err => app.log.error(err, 'Invio email nuovo messaggio fallito'))

    return reply.status(201).send(message)
  })

  // POST /api/chat/:conversationId/read — segna come lette le mie ricevute in questa conversazione
  app.post('/:conversationId/read', auth, async (req, reply) => {
    const conversation = await Conversation.findById(req.params.conversationId)
    if (!conversation) return reply.status(404).send({ error: 'Conversazione non trovata' })
    if (!conversation.participants.some(p => p.toString() === req.user.sub))
      return reply.status(403).send({ error: 'Permesso negato' })

    await Message.updateMany(
      { conversation: conversation._id, sender: { $ne: req.user.sub }, readAt: null },
      { readAt: new Date() }
    )
    return { ok: true }
  })
}
