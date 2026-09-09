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

// Non letti su tutte le conversazioni (dirette e di gruppo): un messaggio
// conta finché il mio id non compare nel suo readBy.
async function unreadCountFor(userId) {
  const conversations = await Conversation.find({ participants: userId }).select('_id').lean()
  return Message.countDocuments({
    conversation: { $in: conversations.map(c => c._id) },
    sender: { $ne: userId },
    readBy: { $ne: userId }
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

async function findDirectConversation(userA, userB) {
  return Conversation.findOne({ type: 'direct', participants: { $all: [userA, userB], $size: 2 } })
}

function otherParticipant(conversation, userId) {
  return conversation.participants.find(p => (p._id || p).toString() !== userId)
}

// Ogni altro partecipante, non solo "l'altro" come nelle dirette: usata per
// il fan-out di notifiche/email ed è l'unico punto che davvero distingue
// diretta da gruppo nell'invio di un messaggio.
function otherParticipantIds(conversation, senderId) {
  return conversation.participants
    .map(p => (p._id || p).toString())
    .filter(id => id !== senderId)
}

// Comune a testo/media/posizione: salva il messaggio, aggiorna la
// conversazione e notifica (email + realtime) ogni altro partecipante,
// diretta o di gruppo che sia.
async function sendMessageToConversation(app, conversation, senderId, fields, req) {
  const message = await new Message({ conversation: conversation._id, sender: senderId, ...fields }).save()
  conversation.lastMessageAt = message.createdAt
  await conversation.save()
  await message.populate('sender', PUBLIC_FIELDS)

  for (const recipientId of otherParticipantIds(conversation, senderId)) {
    notifyNewMessage(message, recipientId).catch(err => app.log.error(err, 'Invio email nuovo messaggio fallito'))
    notifyNewChatEvent(recipientId, message).catch(err => app.log.error(err, 'Creazione notifica nuovo messaggio fallita'))
  }

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

function summarizeConversation(c, userId) {
  const favorite = (c.favoritedBy || []).some(id => id.toString() === userId)
  const base = { _id: c._id, type: c.type, lastMessageAt: c.lastMessageAt, favorite }

  if (c.type === 'group') {
    return {
      ...base,
      name: c.name,
      owner: c.owner,
      members: c.participants,
      isOwner: c.owner?.toString() === userId
    }
  }
  return { ...base, user: otherParticipant(c, userId) }
}

export default async function chatRoutes(app) {

  const auth = { preHandler: [app.authenticate] }

  // Verifica di appartenenza comune a tutte le route sotto :conversationId.
  async function loadMyConversation(req, reply) {
    const conversation = await Conversation.findById(req.params.conversationId)
    if (!conversation) { reply.status(404).send({ error: 'Conversazione non trovata' }); return null }
    if (!conversation.participants.some(p => p.toString() === req.user.sub)) {
      reply.status(403).send({ error: 'Permesso negato' }); return null
    }
    return conversation
  }

  // GET /api/chat/conversations — le mie conversazioni (dirette e di
  // gruppo), con l'ultimo messaggio e il conteggio dei non letti
  app.get('/conversations', auth, async (req) => {
    const userId = req.user.sub
    const conversations = await Conversation.find({ participants: userId })
      .sort({ lastMessageAt: -1 })
      .populate('participants', PUBLIC_FIELDS)
      .lean()

    const data = await Promise.all(conversations.map(async (c) => {
      const [lastMessage, unreadCount] = await Promise.all([
        Message.findOne({ conversation: c._id }).sort({ createdAt: -1 }).lean(),
        Message.countDocuments({ conversation: c._id, sender: { $ne: userId }, readBy: { $ne: userId } })
      ])
      return { ...summarizeConversation(c, userId), lastMessage, unreadCount }
    }))

    return { data }
  })

  // GET /api/chat/unread-count — badge icona chat: somma dei non letti su tutte le conversazioni
  app.get('/unread-count', auth, async (req) => {
    const count = await unreadCountFor(req.user.sub)
    return { count }
  })

  // GET /api/chat/with/:userId — conversazione diretta con un amico (creata al volo se non esiste)
  app.get('/with/:userId', auth, async (req, reply) => {
    const userId = req.user.sub
    const otherId = req.params.userId
    if (otherId === userId) return reply.status(400).send({ error: 'Non puoi scrivere a te stesso' })
    if (!await areFriends(userId, otherId)) return reply.status(403).send({ error: 'Potete scrivervi solo se siete amici' })

    let conversation = await findDirectConversation(userId, otherId)
    if (!conversation) conversation = await new Conversation({ type: 'direct', participants: [userId, otherId] }).save()

    return { _id: conversation._id }
  })

  // GET /api/chat/:conversationId — dettaglio (serve soprattutto per l'header di un gruppo)
  app.get('/:conversationId', auth, async (req, reply) => {
    const conversation = await Conversation.findById(req.params.conversationId).populate('participants', PUBLIC_FIELDS).lean()
    if (!conversation) return reply.status(404).send({ error: 'Conversazione non trovata' })
    if (!conversation.participants.some(p => p._id.toString() === req.user.sub))
      return reply.status(403).send({ error: 'Permesso negato' })

    return summarizeConversation(conversation, req.user.sub)
  })

  // POST /api/chat/groups — crea un gruppo (minimo 3 partecipanti in tutto:
  // io più almeno due amici, altrimenti è solo una chat diretta)
  app.post('/groups', auth, async (req, reply) => {
    const userId = req.user.sub
    const name = req.body.name?.trim()
    const participantIds = [...new Set((req.body.participantIds || []).map(String))].filter(id => id !== userId)

    if (!name) return reply.status(400).send({ error: 'Nome del gruppo obbligatorio' })
    if (participantIds.length < 2) return reply.status(400).send({ error: 'Servono almeno due amici da aggiungere' })

    for (const id of participantIds) {
      if (!await areFriends(userId, id)) return reply.status(403).send({ error: 'Puoi aggiungere solo tuoi amici' })
    }

    const conversation = await new Conversation({
      type: 'group', name, owner: userId, participants: [userId, ...participantIds]
    }).save()

    return reply.status(201).send({ _id: conversation._id })
  })

  // PATCH /api/chat/groups/:conversationId — rinomina (solo il proprietario)
  app.patch('/groups/:conversationId', auth, async (req, reply) => {
    const conversation = await Conversation.findById(req.params.conversationId)
    if (!conversation || conversation.type !== 'group') return reply.status(404).send({ error: 'Gruppo non trovato' })
    if (conversation.owner.toString() !== req.user.sub) return reply.status(403).send({ error: 'Solo il proprietario può modificare il gruppo' })

    const name = req.body.name?.trim()
    if (!name) return reply.status(400).send({ error: 'Nome del gruppo obbligatorio' })

    conversation.name = name
    await conversation.save()
    return { name: conversation.name }
  })

  // POST /api/chat/groups/:conversationId/members — aggiungi membri (solo il proprietario, solo amici)
  app.post('/groups/:conversationId/members', auth, async (req, reply) => {
    const conversation = await Conversation.findById(req.params.conversationId)
    if (!conversation || conversation.type !== 'group') return reply.status(404).send({ error: 'Gruppo non trovato' })
    if (conversation.owner.toString() !== req.user.sub) return reply.status(403).send({ error: 'Solo il proprietario può aggiungere membri' })

    const existing = new Set(conversation.participants.map(p => p.toString()))
    const toAdd = [...new Set((req.body.userIds || []).map(String))].filter(id => !existing.has(id))

    for (const id of toAdd) {
      if (!await areFriends(req.user.sub, id)) return reply.status(403).send({ error: 'Puoi aggiungere solo tuoi amici' })
    }

    conversation.participants.push(...toAdd)
    await conversation.save()
    return { participants: conversation.participants }
  })

  // DELETE /api/chat/groups/:conversationId/members/:userId — rimuovi un membro
  // (il proprietario rimuove chiunque; chiunque può rimuovere se stesso per uscire)
  app.delete('/groups/:conversationId/members/:userId', auth, async (req, reply) => {
    const conversation = await Conversation.findById(req.params.conversationId)
    if (!conversation || conversation.type !== 'group') return reply.status(404).send({ error: 'Gruppo non trovato' })

    const isOwner = conversation.owner.toString() === req.user.sub
    const isSelf = req.params.userId === req.user.sub
    if (!isOwner && !isSelf) return reply.status(403).send({ error: 'Permesso negato' })

    conversation.participants = conversation.participants.filter(p => p.toString() !== req.params.userId)

    // Il proprietario che esce passa il ruolo al membro rimasto da più tempo,
    // così il gruppo non resta senza nessuno che possa gestirlo.
    if (conversation.owner.toString() === req.params.userId && conversation.participants.length) {
      conversation.owner = conversation.participants[0]
    }

    await conversation.save()
    return { participants: conversation.participants, owner: conversation.owner }
  })

  // GET /api/chat/:conversationId/messages — cronologia (solo partecipanti)
  app.get('/:conversationId/messages', auth, async (req, reply) => {
    const conversation = await loadMyConversation(req, reply)
    if (!conversation) return

    const messages = await Message.find({ conversation: conversation._id })
      .sort({ createdAt: 1 })
      .populate('sender', PUBLIC_FIELDS)
      .lean()

    return { data: messages.map(m => withMediaUrl(m, req)) }
  })

  // POST /api/chat/:conversationId/messages — invia un messaggio di testo
  app.post('/:conversationId/messages', auth, async (req, reply) => {
    const conversation = await loadMyConversation(req, reply)
    if (!conversation) return

    const { body } = req.body
    if (!body?.trim()) return reply.status(400).send({ error: 'Messaggio obbligatorio' })

    const result = await sendMessageToConversation(app, conversation, req.user.sub, { body: body.trim() }, req)
    return reply.status(201).send(result)
  })

  // POST /api/chat/:conversationId/messages/media — foto, video, file, vocali
  app.post('/:conversationId/messages/media', auth, async (req, reply) => {
    const conversation = await loadMyConversation(req, reply)
    if (!conversation) return

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

    const result = await sendMessageToConversation(app, conversation, req.user.sub, { type, media: uploadedFile }, req)
    return reply.status(201).send(result)
  })

  // POST /api/chat/:conversationId/messages/location — condivisione posizione attuale
  app.post('/:conversationId/messages/location', auth, async (req, reply) => {
    const conversation = await loadMyConversation(req, reply)
    if (!conversation) return

    const { lat, lng, name } = req.body
    if (typeof lat !== 'number' || typeof lng !== 'number') return reply.status(400).send({ error: 'Coordinate obbligatorie' })

    const result = await sendMessageToConversation(app, conversation, req.user.sub, { type: 'location', location: { lat, lng, name } }, req)
    return reply.status(201).send(result)
  })

  // PATCH /api/chat/messages/:messageId — modifica un messaggio di testo proprio
  app.patch('/messages/:messageId', auth, async (req, reply) => {
    const message = await Message.findById(req.params.messageId)
    if (!message) return reply.status(404).send({ error: 'Messaggio non trovato' })
    if (message.sender.toString() !== req.user.sub) return reply.status(403).send({ error: 'Permesso negato' })
    if (message.deleted) return reply.status(400).send({ error: 'Messaggio eliminato' })
    if (message.type !== 'text') return reply.status(400).send({ error: 'Puoi modificare solo i messaggi di testo' })

    const { body } = req.body
    if (!body?.trim()) return reply.status(400).send({ error: 'Messaggio obbligatorio' })

    message.body = body.trim()
    message.editedAt = new Date()
    await message.save()
    await message.populate('sender', PUBLIC_FIELDS)

    const conversation = await Conversation.findById(message.conversation)
    for (const recipientId of otherParticipantIds(conversation, req.user.sub)) {
      sendToUser(recipientId, { type: 'chat:message-updated', conversationId: message.conversation, message })
    }

    return withMediaUrl(message.toObject(), req)
  })

  // DELETE /api/chat/messages/:messageId — elimina (per tutti) un proprio messaggio
  app.delete('/messages/:messageId', auth, async (req, reply) => {
    const message = await Message.findById(req.params.messageId)
    if (!message) return reply.status(404).send({ error: 'Messaggio non trovato' })
    if (message.sender.toString() !== req.user.sub) return reply.status(403).send({ error: 'Permesso negato' })

    if (message.media?.filename) {
      try { await fs.unlink(path.join(uploadsDir(), message.media.filename)) } catch {}
    }

    message.deleted = true
    message.body = undefined
    message.media = undefined
    message.location = undefined
    await message.save()

    const conversation = await Conversation.findById(message.conversation)
    for (const recipientId of otherParticipantIds(conversation, req.user.sub)) {
      sendToUser(recipientId, { type: 'chat:message-deleted', conversationId: message.conversation, messageId: message._id })
    }

    return { deleted: true }
  })

  // POST /api/chat/:conversationId/read — segna come lette le mie ricevute in questa conversazione
  app.post('/:conversationId/read', auth, async (req, reply) => {
    const conversation = await loadMyConversation(req, reply)
    if (!conversation) return

    await Message.updateMany(
      { conversation: conversation._id, sender: { $ne: req.user.sub }, readBy: { $ne: req.user.sub } },
      { $addToSet: { readBy: req.user.sub } }
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

  // PATCH /api/chat/:conversationId/favorite — preferito personale: non è
  // uno stato condiviso, ognuno dei partecipanti ha i suoi.
  app.patch('/:conversationId/favorite', auth, async (req, reply) => {
    const conversation = await loadMyConversation(req, reply)
    if (!conversation) return

    const userId = req.user.sub
    const favorite = !!req.body.favorite
    const already = conversation.favoritedBy.some(id => id.toString() === userId)

    if (favorite && !already) conversation.favoritedBy.push(userId)
    if (!favorite && already) conversation.favoritedBy = conversation.favoritedBy.filter(id => id.toString() !== userId)

    await conversation.save()
    return { favorite }
  })
}
