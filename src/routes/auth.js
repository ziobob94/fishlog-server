import fs from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import { nanoid } from 'nanoid'
import AppConfig from '../config.js'
import User from '../models/User.js'
import Session from '../models/Session.js'
import Post from '../models/Post.js'
import Group from '../models/Group.js'
import Friendship from '../models/Friendship.js'
import Conversation from '../models/Conversation.js'
import Message from '../models/Message.js'
import { sendMail, welcomeEmail, securityAlertEmail, passwordResetEmail, emailChangeConfirmEmail } from '../utils/mailer.js'

const cfg = new AppConfig()

const GOOGLE_CLIENT_ID     = cfg.get('oauth.google.clientId')
const GOOGLE_CLIENT_SECRET = cfg.get('oauth.google.clientSecret')
const GOOGLE_CALLBACK_URL  = cfg.get('oauth.google.callbackUrl')

const FACEBOOK_APP_ID      = cfg.get('oauth.facebook.appId')
const FACEBOOK_APP_SECRET  = cfg.get('oauth.facebook.appSecret')
const FACEBOOK_CALLBACK_URL = cfg.get('oauth.facebook.callbackUrl')

const CLIENT_URL = cfg.get('client.url')

const AVATAR_MIME = {
  'image/jpeg': '.jpg',
  'image/png':  '.png',
  'image/webp': '.webp'
}

function uploadsDir() {
  return path.resolve(cfg.get('app.dirs.uploads'))
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function passwordAuthEnabled() {
  return cfg.get('features.passwordAuth', true)
}

export default async function authRoutes(app) {

  // ── helpers ────────────────────────────────────────────────────────────
  function signToken(user) {
    return app.jwt.sign(
      { sub: user._id.toString(), email: user.email, name: user.displayName, role: user.role || 'user' },
      { expiresIn: cfg.get('jwt.expiresIn') }
    )
  }

  function redirectWithToken(reply, token) {
    return reply.redirect(`${CLIENT_URL}/auth/callback?token=${token}`)
  }

  function requirePasswordAuth(reply) {
    if (passwordAuthEnabled()) return true
    reply.status(503).send({ error: 'Funzionalità temporaneamente non disponibile' })
    return false
  }

  // ── feature flags pubblici ───────────────────────────────────────────────
  app.get('/features', async () => ({ passwordAuthEnabled: passwordAuthEnabled() }))

  // ── register ───────────────────────────────────────────────────────────
  app.post('/register', async (req, reply) => {
    if (!requirePasswordAuth(reply)) return

    const { email, password, displayName } = req.body
    if (!email || !password)
      return reply.status(400).send({ error: 'Email e password obbligatorie' })
    if (password.length < 6)
      return reply.status(400).send({ error: 'Password minimo 6 caratteri' })

    if (await User.findOne({ email }))
      return reply.status(409).send({ error: 'Email già registrata' })

    const user = new User({ email, displayName: displayName || email.split('@')[0] })
    await user.setPassword(password)
    await user.save()

    await sendMail({ to: user.email, ...welcomeEmail(user.displayName, CLIENT_URL) })

    return reply.status(201).send({ token: signToken(user), user: publicUser(user) })
  })

  // ── login ──────────────────────────────────────────────────────────────
  app.post('/login', async (req, reply) => {
    const { email, password } = req.body
    if (!email || !password)
      return reply.status(400).send({ error: 'Email e password obbligatorie' })

    const user = await User.findOne({ email })
    if (!user || !(await user.checkPassword(password)))
      return reply.status(401).send({ error: 'Credenziali non valide' })

    return { token: signToken(user), user: publicUser(user) }
  })

  // ── me ─────────────────────────────────────────────────────────────────
  app.get('/me', { preHandler: [app.authenticate] }, async (req) => {
    const user = await User.findById(req.user.sub).lean()
    if (!user) throw { statusCode: 404, message: 'Utente non trovato' }
    return publicUser(user)
  })

  // ── aggiorna profilo (nome, privacy di default) ──────────────────────────
  app.patch('/me', { preHandler: [app.authenticate] }, async (req, reply) => {
    const user = await User.findById(req.user.sub)
    if (!user) return reply.status(404).send({ error: 'Utente non trovato' })

    const { displayName, defaultVisibility } = req.body
    if (displayName !== undefined) user.displayName = displayName
    if (defaultVisibility !== undefined) {
      if (!['public', 'users', 'group', 'private'].includes(defaultVisibility))
        return reply.status(400).send({ error: 'Visibilità non valida' })
      user.defaultVisibility = defaultVisibility
    }
    await user.save()
    return publicUser(user)
  })

  // ── modalità negozio (vetrina nel market) ────────────────────────────
  app.patch('/me/shop', { preHandler: [app.authenticate] }, async (req, reply) => {
    const user = await User.findById(req.user.sub)
    if (!user) return reply.status(404).send({ error: 'Utente non trovato' })

    const { enabled, name, description } = req.body
    // Attivare per la prima volta (o dopo un rifiuto) rimette la richiesta
    // in coda di revisione: solo l'admin può portarla a "verified".
    if (enabled !== undefined) {
      user.shop.enabled = !!enabled
      if (enabled && ['none', 'rejected'].includes(user.shop.verificationStatus)) {
        user.shop.verificationStatus = 'pending'
        user.shop.verificationRequestedAt = new Date()
      }
    }
    if (name !== undefined)        user.shop.name = name
    if (description !== undefined) user.shop.description = description

    await user.save()
    return publicUser(user)
  })

  // ── preferenze notifiche email ───────────────────────────────────────
  app.patch('/me/notifications', { preHandler: [app.authenticate] }, async (req, reply) => {
    const user = await User.findById(req.user.sub)
    if (!user) return reply.status(404).send({ error: 'Utente non trovato' })

    const { emailChatMessages, emailComments, emailLikes, emailFriendRequests } = req.body
    if (emailChatMessages   !== undefined) user.notificationPreferences.emailChatMessages   = !!emailChatMessages
    if (emailComments       !== undefined) user.notificationPreferences.emailComments       = !!emailComments
    if (emailLikes          !== undefined) user.notificationPreferences.emailLikes          = !!emailLikes
    if (emailFriendRequests !== undefined) user.notificationPreferences.emailFriendRequests = !!emailFriendRequests

    await user.save()
    return publicUser(user)
  })

  // ── avatar ────────────────────────────────────────────────────────────
  app.post('/me/avatar', { preHandler: [app.authenticate] }, async (req, reply) => {
    const user = await User.findById(req.user.sub)
    if (!user) return reply.status(404).send({ error: 'Utente non trovato' })

    const part = await req.file()
    if (!part) return reply.status(400).send({ error: 'Nessun file ricevuto' })

    const ext = AVATAR_MIME[part.mimetype]
    if (!ext) return reply.status(400).send({ error: 'Formato non supportato (JPG, PNG, WEBP)' })

    await fs.mkdir(uploadsDir(), { recursive: true })
    const filename = `avatar_${nanoid()}_${Date.now()}${ext}`
    const buffer = await part.toBuffer()
    await fs.writeFile(path.join(uploadsDir(), filename), buffer)

    user.avatar = `${req.protocol}://${req.headers.host}/uploads/${filename}`
    await user.save()
    return publicUser(user)
  })

  // ── cambio password ───────────────────────────────────────────────────
  app.patch('/me/password', { preHandler: [app.authenticate] }, async (req, reply) => {
    if (!requirePasswordAuth(reply)) return
    const user = await User.findById(req.user.sub)
    if (!user) return reply.status(404).send({ error: 'Utente non trovato' })
    if (!user.passwordHash)
      return reply.status(400).send({ error: 'Account collegato solo a provider social, nessuna password da cambiare' })

    const { currentPassword, newPassword } = req.body
    if (!currentPassword || !newPassword)
      return reply.status(400).send({ error: 'Password attuale e nuova obbligatorie' })
    if (newPassword.length < 6)
      return reply.status(400).send({ error: 'Nuova password minimo 6 caratteri' })
    if (!(await user.checkPassword(currentPassword)))
      return reply.status(401).send({ error: 'Password attuale errata' })

    await user.setPassword(newPassword)
    await user.save()

    await sendMail({ to: user.email, ...securityAlertEmail('La password del tuo account Fishlog è stata cambiata.') })

    return { updated: true }
  })

  // ── password dimenticata ────────────────────────────────────────────────
  app.post('/forgot-password', async (req, reply) => {
    if (!requirePasswordAuth(reply)) return
    const { email } = req.body
    if (!email) return reply.status(400).send({ error: 'Email obbligatoria' })

    const user = await User.findOne({ email: email.toLowerCase().trim() })
    if (user && user.passwordHash) {
      const token = crypto.randomBytes(32).toString('hex')
      user.passwordResetTokenHash = hashToken(token)
      user.passwordResetExpires   = new Date(Date.now() + 60 * 60 * 1000) // 1h
      await user.save()

      const link = `${CLIENT_URL}/reset-password?token=${token}`
      await sendMail({ to: user.email, ...passwordResetEmail(link) })
    }

    // Risposta identica in ogni caso: non riveliamo se l'email esiste
    return { sent: true }
  })

  app.post('/reset-password', async (req, reply) => {
    if (!requirePasswordAuth(reply)) return
    const { token, newPassword } = req.body
    if (!token || !newPassword) return reply.status(400).send({ error: 'Token e nuova password obbligatori' })
    if (newPassword.length < 6) return reply.status(400).send({ error: 'Nuova password minimo 6 caratteri' })

    const user = await User.findOne({
      passwordResetTokenHash: hashToken(token),
      passwordResetExpires: { $gt: new Date() }
    })
    if (!user) return reply.status(400).send({ error: 'Link non valido o scaduto' })

    await user.setPassword(newPassword)
    user.passwordResetTokenHash = undefined
    user.passwordResetExpires   = undefined
    await user.save()

    await sendMail({ to: user.email, ...securityAlertEmail('La password del tuo account Fishlog è stata reimpostata.') })

    return { reset: true }
  })

  // ── cambio email (richiede conferma via link) ──────────────────────────
  app.patch('/me/email', { preHandler: [app.authenticate] }, async (req, reply) => {
    if (!requirePasswordAuth(reply)) return
    const user = await User.findById(req.user.sub)
    if (!user) return reply.status(404).send({ error: 'Utente non trovato' })

    const { newEmail, currentPassword } = req.body
    if (!newEmail) return reply.status(400).send({ error: 'Nuova email obbligatoria' })
    if (user.passwordHash) {
      if (!currentPassword) return reply.status(400).send({ error: 'Password attuale obbligatoria' })
      if (!(await user.checkPassword(currentPassword)))
        return reply.status(401).send({ error: 'Password attuale errata' })
    }

    const normalized = newEmail.toLowerCase().trim()
    const existing = await User.findOne({ email: normalized })
    if (existing && existing._id.toString() !== user._id.toString())
      return reply.status(409).send({ error: 'Email già in uso' })

    const token = crypto.randomBytes(32).toString('hex')
    user.pendingEmail         = normalized
    user.emailChangeTokenHash = hashToken(token)
    user.emailChangeExpires   = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24h
    await user.save()

    const link = `${req.protocol}://${req.headers.host}/api/auth/confirm-email?token=${token}`
    await sendMail({ to: normalized, ...emailChangeConfirmEmail(link) })

    return { pending: true, pendingEmail: normalized }
  })

  // ── conferma cambio email (link cliccato dall'utente) ──────────────────
  app.get('/confirm-email', async (req, reply) => {
    const { token } = req.query
    if (!token) return reply.redirect(`${CLIENT_URL}/confirm-email?status=error`)

    const user = await User.findOne({
      emailChangeTokenHash: hashToken(token),
      emailChangeExpires: { $gt: new Date() }
    })
    if (!user) return reply.redirect(`${CLIENT_URL}/confirm-email?status=error`)

    const oldEmail = user.email
    user.email = user.pendingEmail
    user.pendingEmail         = undefined
    user.emailChangeTokenHash = undefined
    user.emailChangeExpires   = undefined
    await user.save()

    if (oldEmail) {
      await sendMail({ to: oldEmail, ...securityAlertEmail(`L'email del tuo account Fishlog è stata cambiata in ${user.email}.`) })
    }

    return reply.redirect(`${CLIENT_URL}/confirm-email?status=ok`)
  })

  // ── eliminazione account ──────────────────────────────────────────────
  app.delete('/me', { preHandler: [app.authenticate] }, async (req, reply) => {
    const user = await User.findById(req.user.sub)
    if (!user) return reply.status(404).send({ error: 'Utente non trovato' })

    if (user.passwordHash) {
      const { password } = req.body
      if (!password || !(await user.checkPassword(password)))
        return reply.status(401).send({ error: 'Password errata' })
    }

    const ownedGroups = await Group.find({ owner: user._id })
    const blockingGroup = ownedGroups.find(g => g.members.some(m => m.toString() !== user._id.toString()))
    if (blockingGroup)
      return reply.status(400).send({ error: `Trasferisci la proprietà del gruppo "${blockingGroup.name}" prima di eliminare l'account` })

    const conversations = await Conversation.find({ participants: user._id }).select('_id')

    await Group.deleteMany({ _id: { $in: ownedGroups.map(g => g._id) } })
    await Group.updateMany({ members: user._id }, { $pull: { members: user._id } })
    await Session.deleteMany({ userId: user._id })
    await Post.deleteMany({ author: user._id })
    await Friendship.deleteMany({ $or: [{ requester: user._id }, { recipient: user._id }] })
    await Message.deleteMany({ conversation: { $in: conversations.map(c => c._id) } })
    await Conversation.deleteMany({ _id: { $in: conversations.map(c => c._id) } })
    await User.findByIdAndDelete(user._id)

    return { deleted: true }
  })

  // ── Google OAuth ───────────────────────────────────────────────────────
  app.get('/google', async (req, reply) => {
    const params = new URLSearchParams({
      client_id:     GOOGLE_CLIENT_ID,
      redirect_uri:  GOOGLE_CALLBACK_URL,
      response_type: 'code',
      scope:         'openid email profile',
      access_type:   'online'
    })
    return reply.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
  })

  app.get('/google/callback', async (req, reply) => {
    const { code } = req.query
    if (!code) return reply.status(400).send({ error: 'Codice mancante' })

    // Scambia code → token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri:  GOOGLE_CALLBACK_URL,
        grant_type:    'authorization_code'
      })
    })
    const tokens = await tokenRes.json()
    if (!tokens.access_token) return reply.status(400).send({ error: 'OAuth Google fallito' })

    // Ottieni profilo
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    })
    const profile = await profileRes.json()

    const user = await upsertOAuthUser({
      provider: 'google', providerId: profile.sub,
      email: profile.email, displayName: profile.name, avatar: profile.picture
    })

    return redirectWithToken(reply, signToken(user))
  })

  // ── Facebook OAuth ─────────────────────────────────────────────────────
  app.get('/facebook', async (req, reply) => {
    const params = new URLSearchParams({
      client_id:     FACEBOOK_APP_ID,
      redirect_uri:  FACEBOOK_CALLBACK_URL,
      response_type: 'code',
      scope:         'email,public_profile'
    })
    return reply.redirect(`https://www.facebook.com/v19.0/dialog/oauth?${params}`)
  })

  app.get('/facebook/callback', async (req, reply) => {
    const { code } = req.query
    if (!code) return reply.status(400).send({ error: 'Codice mancante' })

    const tokenRes = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?` +
      new URLSearchParams({
        client_id:     FACEBOOK_APP_ID,
        client_secret: FACEBOOK_APP_SECRET,
        redirect_uri:  FACEBOOK_CALLBACK_URL,
        code
      })
    )
    const tokens = await tokenRes.json()
    if (!tokens.access_token) return reply.status(400).send({ error: 'OAuth Facebook fallito' })

    const profileRes = await fetch(
      `https://graph.facebook.com/me?fields=id,name,email,picture&access_token=${tokens.access_token}`
    )
    const profile = await profileRes.json()

    const user = await upsertOAuthUser({
      provider: 'facebook', providerId: profile.id,
      email: profile.email, displayName: profile.name,
      avatar: profile.picture?.data?.url
    })

    return redirectWithToken(reply, signToken(user))
  })

  // ── helpers ────────────────────────────────────────────────────────────
  async function upsertOAuthUser({ provider, providerId, email, displayName, avatar }) {
    const providerKey = `providers.${provider}.id`

    let user = await User.findOne({ [providerKey]: providerId })
    if (!user && email) user = await User.findOne({ email })

    const isNewUser = !user
    if (!user) {
      user = new User({ email, displayName, avatar })
    } else {
      user.displayName = user.displayName || displayName
      user.avatar      = user.avatar || avatar
    }

    user.providers[provider] = { id: providerId }
    await user.save()

    if (isNewUser && user.email) await sendMail({ to: user.email, ...welcomeEmail(user.displayName, CLIENT_URL) })

    return user
  }

  function publicUser(user) {
    return {
      _id:               user._id,
      email:             user.email,
      displayName:       user.displayName,
      avatar:            user.avatar,
      role:              user.role,
      defaultVisibility: user.defaultVisibility,
      notificationPreferences: {
        emailChatMessages:   user.notificationPreferences?.emailChatMessages   !== false,
        emailComments:       user.notificationPreferences?.emailComments       !== false,
        emailLikes:          user.notificationPreferences?.emailLikes          !== false,
        emailFriendRequests: user.notificationPreferences?.emailFriendRequests !== false
      },
      hasPassword:       !!user.passwordHash,
      pendingEmail:      user.pendingEmail || null,
      shop: {
        enabled:            !!user.shop?.enabled,
        name:               user.shop?.name || '',
        description:        user.shop?.description || '',
        verificationStatus: user.shop?.verificationStatus || 'none'
      },
      providers:         { google: !!user.providers?.google?.id, facebook: !!user.providers?.facebook?.id }
    }
  }
}