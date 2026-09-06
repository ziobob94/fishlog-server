import fs from 'fs/promises'
import path from 'path'
import { nanoid } from 'nanoid'
import Conversation from '../models/Conversation.js'
import Message from '../models/Message.js'
import Friendship from '../models/Friendship.js'
import User from '../models/User.js'
import Notification from '../models/Notification.js'
import AppConfig from '../config.js'
import { sendMail, newChatMessageEmail } from '../utils/mailer.js'
import { sendToUser } from '../ws/hub.js'

const cfg = new AppConfig()
const CLIENT_URL = cfg.get('client.url')

const PUBLIC_FIELDS = 'displayName email avatar'

function uploadsDir() {
  return path.resolve(cfg.get('app.dirs.uploads'))
}

// Aggiunge l'url pubblico del media al volo, senza salvarlo in DB (stesso
// pattern di src/routes/media.js).
function withMediaUrl(message, req) {
  if (!message.media?.filename) return message
  const baseUrl = `${req.protocol}://${req.headers.host}`
  return { ...message, media: { ...message.media, url: `${baseUrl}/uploads/${message.media.filename}` } }
}

// Testo sintetico usato per email/anteprime quando il messaggio non è testo.
function previewFor(message) {
  if (message.type === 'text') return message.body
  if (message.type === 'image') return '📷 Foto'
  if (message.type === 'video') return '🎥 Video'
  if (message.type === 'audio') return '🎤 Messaggio vocale'
  if (message.type === 'location') return '📍 Posizione'
  if (message.type === 'file') return `📎 ${message.media?.originalName || 'File'}`
  return 'Nuovo messaggio'
}

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

async function unreadCountFor(userId) {
  const conversations = await Conversation.find({ participants: userId }).select('_id').lean()
  return Message.countDocuments({
    conversation: { $in: conversations.map(c => c._id) },
    sender: { $ne: userId },
    readAt: null
  })
}

// Persiste una notifica "nuovo messaggio" e spinge in realtime il conteggio
// non letti aggiornato, così il badge si aggiorna senza ricaricare la lista.
async function notifyNewChatEvent(recipientId, message) {
  const notification = await new Notification({
    recipient: recipientId,
    type: 'chat_message',
    actor: message.sender._id ?? message.sender,
    data: { conversationId: message.conversation }
  }).save()
  sendToUser(recipientId, { type: 'notification', payload: notification })

  const count = await unreadCountFor(recipientId)
  sendToUser(recipientId, { type: 'chat:unread', conversationId: message.conversation, count })
}

async function findConversation(userA, userB) {
  return Conversation.findOne({ participants: { $all: [userA, userB], $size: 2 } })
}

function otherParticipant(conversation, userId) {
  return conversation.participants.find(p => p._id.toString() !== userId)
}

// Comune a testo/media/posizione: aggiorna la conversazione, notifica il
// destinatario (email + realtime) e restituisce il messaggio pronto per la risposta HTTP.
async function finalizeMessage(app, conversation, message, otherId, req) {
  conversation.lastMessageAt = message.createdAt
  await conversation.save()
  await message.populate('sender', PUBLIC_FIELDS)

  notifyNewMessage(message, otherId).catch(err => app.log.error(err, 'Invio email nuovo messaggio fallito'))
  notifyNewChatEvent(otherId, message).catch(err => app.log.error(err, 'Creazione notifica nuovo messaggio fallita'))

  return withMediaUrl(message.toObject(), req)
}

// Avvisa il destinatario via email, solo se ha l'email e non l'ha disattivato
// dal profilo (Notifiche). Non blocca la risposta HTTP: va chiamata "fire and forget".
async function notifyNewMessage(message, recipientId) {
  const recipient = await User.findById(recipientId)
  if (!recipient?.email || recipient.notificationPreferences?.emailChatMessages === false) return

  const text = previewFor(message)
  const preview = text.length > 200 ? `${text.slice(0, 200)}…` : text
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
    const count = await unreadCountFor(req.user.sub)
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

    return { data: messages.map(m => withMediaUrl(m, req)) }
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
    const result = await finalizeMessage(app, conversation, message, otherId, req)

    return reply.status(201).send(result)
  })

  // POST /api/chat/with/:userId/messages/media — foto, video, file, vocali
  app.post('/with/:userId/messages/media', auth, async (req, reply) => {
    const userId = req.user.sub
    const otherId = req.params.userId
    if (otherId === userId) return reply.status(400).send({ error: 'Non puoi scrivere a te stesso' })
    if (!await areFriends(userId, otherId)) return reply.status(403).send({ error: 'Potete scrivervi solo se siete amici' })

    await fs.mkdir(uploadsDir(), { recursive: true })

    let uploadedFile = null
    for await (const part of req.parts()) {
      if (part.type !== 'file') continue
      const ext = path.extname(part.filename) || ''
      const filename = `${nanoid()}_${Date.now()}${ext}`
      const buffer = await part.toBuffer()
      await fs.writeFile(path.join(uploadsDir(), filename), buffer)
      uploadedFile = { filename, originalName: part.filename, mimetype: part.mimetype, size: buffer.length }
      break // un allegato per messaggio
    }
    if (!uploadedFile) return reply.status(400).send({ error: 'File obbligatorio' })

    const type = uploadedFile.mimetype.startsWith('image/') ? 'image'
      : uploadedFile.mimetype.startsWith('video/') ? 'video'
      : uploadedFile.mimetype.startsWith('audio/') ? 'audio'
      : 'file'

    let conversation = await findConversation(userId, otherId)
    if (!conversation) conversation = await new Conversation({ participants: [userId, otherId] }).save()

    const message = await new Message({ conversation: conversation._id, sender: userId, type, media: uploadedFile }).save()
    const result = await finalizeMessage(app, conversation, message, otherId, req)

    return reply.status(201).send(result)
  })

  // POST /api/chat/with/:userId/messages/location — condivisione posizione attuale
  app.post('/with/:userId/messages/location', auth, async (req, reply) => {
    const userId = req.user.sub
    const otherId = req.params.userId
    if (otherId === userId) return reply.status(400).send({ error: 'Non puoi scrivere a te stesso' })
    if (!await areFriends(userId, otherId)) return reply.status(403).send({ error: 'Potete scrivervi solo se siete amici' })

    const { lat, lng, name } = req.body
    if (typeof lat !== 'number' || typeof lng !== 'number') return reply.status(400).send({ error: 'Coordinate obbligatorie' })

    let conversation = await findConversation(userId, otherId)
    if (!conversation) conversation = await new Conversation({ participants: [userId, otherId] }).save()

    const message = await new Message({ conversation: conversation._id, sender: userId, type: 'location', location: { lat, lng, name } }).save()
    const result = await finalizeMessage(app, conversation, message, otherId, req)

    return reply.status(201).send(result)
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

    // Aprire la chat equivale a leggerne i messaggi: le notifiche "nuovo
    // messaggio" collegate a questa conversazione vanno segnate lette anche
    // se l'utente non è passato dal centro notifiche, altrimenti restano
    // visibili lì pur avendo già letto il messaggio.
    const { modifiedCount } = await Notification.updateMany(
      { recipient: req.user.sub, type: 'chat_message', 'data.conversationId': conversation._id, read: false },
      { read: true }
    )
    if (modifiedCount > 0) {
      const count = await Notification.countDocuments({ recipient: req.user.sub, read: false })
      sendToUser(req.user.sub, { type: 'notifications:read', conversationId: conversation._id, count })
    }

    return { ok: true }
  })
}
