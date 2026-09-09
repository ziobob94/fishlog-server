import User from '../models/User.js'
import Session from '../models/Session.js'
import RuntimeConfig from '../models/RuntimeConfig.js'
import AppConfig from '../config.js'
import { reloadRuntimeConfig } from '../runtimeConfigStore.js'
import { CONFIG_MANIFEST, CONFIG_MANIFEST_BY_KEY } from '../configManifest.js'
import { escapeRegExp } from '../utils/regex.js'

const cfg = new AppConfig()

export default async function adminRoutes(app) {

  const adminOnly = { preHandler: [app.requireRole('admin')] }
  const modOrAdmin = { preHandler: [app.requireRole('admin', 'moderator')] }

  // GET /api/admin/users
  app.get('/users', adminOnly, async (req) => {
    const { page = 1, limit = 30, search } = req.query
    const filter = search
      ? { $or: [{ email: new RegExp(escapeRegExp(search), 'i') }, { displayName: new RegExp(escapeRegExp(search), 'i') }] }
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

  // GET /api/admin/shops/pending — richieste di attivazione negozio da revisionare
  app.get('/shops/pending', adminOnly, async () => {
    const data = await User.find({ 'shop.verificationStatus': 'pending' })
      .select('displayName email shop').sort({ 'shop.verificationRequestedAt': 1 }).lean()
    return { data }
  })

  // POST /api/admin/shops/:id/approve
  app.post('/shops/:id/approve', adminOnly, async (req, reply) => {
    const user = await User.findById(req.params.id)
    if (!user) return reply.status(404).send({ error: 'Utente non trovato' })

    user.shop.verificationStatus = 'verified'
    user.shop.verifiedAt = new Date()
    await user.save()
    return user.sanitize()
  })

  // POST /api/admin/shops/:id/reject
  app.post('/shops/:id/reject', adminOnly, async (req, reply) => {
    const user = await User.findById(req.params.id)
    if (!user) return reply.status(404).send({ error: 'Utente non trovato' })

    user.shop.verificationStatus = 'rejected'
    user.shop.enabled = false
    await user.save()
    return user.sanitize()
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

  // GET /api/admin/config — configurazioni modificabili da interfaccia
  // (eBay, OAuth, SMTP, feature flag...). I valori "secret" non vengono mai
  // restituiti in chiaro: solo un flag hasValue che dice se sono impostati.
  app.get('/config', adminOnly, async () => {
    return CONFIG_MANIFEST.map(({ key, group, label, type, secret }) => {
      const raw = cfg.get(key, type === 'boolean' ? false : '')
      return {
        key, group, label, type, secret,
        value: secret ? '' : raw,
        hasValue: secret ? !!raw : undefined
      }
    })
  })

  // PUT /api/admin/config — salva un sottoinsieme di configurazioni.
  // Accetta solo chiavi presenti nel manifest (whitelist): qualsiasi altra
  // chiave nel body viene ignorata. Un campo "secret" con valore vuoto non
  // sovrascrive quello già salvato, così non serve reinserire la password
  // ogni volta che si cambia un altro campo dello stesso gruppo.
  app.put('/config', adminOnly, async (req, reply) => {
    const updates = Array.isArray(req.body) ? req.body : []

    for (const { key, value } of updates) {
      const meta = CONFIG_MANIFEST_BY_KEY[key]
      if (!meta) continue
      if (meta.secret && (value === '' || value === undefined || value === null)) continue

      let coerced = value
      // Un valore incollato dall'esterno (es. client ID/secret di un
      // portale terzo) porta facilmente uno spazio o un a-capo finale:
      // invisibile nel campo, ma invalida credenziali altrimenti corrette.
      if (meta.type === 'string' && typeof coerced === 'string') coerced = coerced.trim()
      if (meta.type === 'boolean') coerced = !!value
      if (meta.type === 'number') coerced = Number(value)

      await RuntimeConfig.findOneAndUpdate({ key }, { key, value: coerced }, { upsert: true })
    }

    await reloadRuntimeConfig()
    return { updated: true }
  })
}