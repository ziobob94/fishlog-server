import AppConfig from '../config.js'
import User from '../models/User.js'

const cfg = new AppConfig()

const GOOGLE_CLIENT_ID     = cfg.get('oauth.google.clientId')
const GOOGLE_CLIENT_SECRET = cfg.get('oauth.google.clientSecret')
const GOOGLE_CALLBACK_URL  = cfg.get('oauth.google.callbackUrl')

const FACEBOOK_APP_ID      = cfg.get('oauth.facebook.appId')
const FACEBOOK_APP_SECRET  = cfg.get('oauth.facebook.appSecret')
const FACEBOOK_CALLBACK_URL = cfg.get('oauth.facebook.callbackUrl')

const CLIENT_URL = cfg.get('client.url')

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

  // ── register ───────────────────────────────────────────────────────────
  app.post('/register', async (req, reply) => {
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

    if (!user) {
      user = new User({ email, displayName, avatar })
    } else {
      user.displayName = user.displayName || displayName
      user.avatar      = user.avatar || avatar
    }

    user.providers[provider] = { id: providerId }
    await user.save()
    return user
  }

  function publicUser(user) {
    return {
      _id:         user._id,
      email:       user.email,
      displayName: user.displayName,
      avatar:      user.avatar
    }
  }
}