import fs from 'fs/promises'
import path from 'path'
import { nanoid } from 'nanoid'
import Story from '../models/Story.js'
import Session from '../models/Session.js'
import Friendship from '../models/Friendship.js'
import AppConfig from '../config.js'

const cfg = new AppConfig()

const PUBLIC_FIELDS = 'displayName avatar'
const TTL_MS = 24 * 60 * 60 * 1000
const ALLOWED_MIME = { 'image/jpeg': 'photo', 'image/png': 'photo', 'image/webp': 'photo', 'image/heic': 'photo', 'video/mp4': 'video', 'video/quicktime': 'video' }

function uploadsDir() { return path.resolve(cfg.get('app.dirs.uploads')) }

async function friendIds(userId) {
  const rows = await Friendship.find({ status: 'accepted', $or: [{ requester: userId }, { recipient: userId }] }).lean()
  return rows.map(r => (r.requester.toString() === userId ? r.recipient : r.requester).toString())
}

const fmtCoords = c => (c?.lat != null && c?.lng != null) ? `${Number(c.lat).toFixed(2)}°N · ${Number(c.lng).toFixed(2)}°E` : ''

// Costruisce l'adesivo dal dato reale dell'uscita dell'autore: il client indica
// solo cosa vuole mostrare, il contenuto viene letto dal server.
async function buildSticker(userId, raw) {
  const session = await Session.findOne({ _id: raw.sessionId, userId }).lean()
  if (!session) return null
  if (raw.kind === 'catch') {
    const c = (session.catches || []).find(x => x._id.toString() === String(raw.catchId))
    if (!c) return null
    const size = c.lengthCm ? `${c.lengthCm} cm` : (c.weightKg ? `${c.weightKg} kg` : '')
    const sub = [fmtCoords(session.location?.coords), c.released ? 'rilasciata' : ''].filter(Boolean).join(' · ')
    return { kind: 'catch', label: [c.species, size].filter(Boolean).join(' · '), subtitle: sub, session: session._id, catchId: c._id }
  }
  if (raw.kind === 'place') {
    const name = session.location?.name || session.title
    if (!name) return null
    return { kind: 'place', label: name, subtitle: fmtCoords(session.location?.coords), session: session._id }
  }
  if (raw.kind === 'water') {
    const sea = session.sea || {}, w = session.weather || {}
    const parts = [sea.seaState && sea.seaState.replace('_', ' '), sea.waterTemp != null && `${sea.waterTemp}°`, w.windSpeed != null && `${w.windSpeed} km/h`, w.tempAir != null && `aria ${w.tempAir}°C`].filter(Boolean)
    if (!parts.length) return null
    return { kind: 'water', label: parts.join(' · '), session: session._id }
  }
  return null
}

function serialize(story, req, meId) {
  const baseUrl = `${req.protocol}://${req.headers.host}`
  const own = (story.author._id || story.author).toString() === meId
  return {
    _id: story._id,
    media: story.media?.filename ? { type: story.media.type, url: `${baseUrl}/uploads/${story.media.filename}` } : null,
    stickers: story.stickers,
    audience: story.audience,
    createdAt: story.createdAt,
    expiresAt: story.expiresAt,
    seen: own || (story.views || []).some(v => v.user.toString() === meId),
    liked: (story.likes || []).some(u => u.toString() === meId),
    ...(own ? { viewCount: story.views?.length || 0, likeCount: story.likes?.length || 0 } : {})
  }
}

export default async function storyRoutes(app) {
  const auth = { preHandler: [app.authenticate] }

  async function canSee(story, meId, friends) {
    const authorId = story.author._id?.toString() || story.author.toString()
    if (authorId === meId) return true
    if (friends.includes(authorId)) return true
    return story.audience === 'all'
  }

  // GET /api/stories — storie attive degli amici e mie, raggruppate per autore
  // (le mie per prime; gli autori con storie non viste prima delle viste).
  app.get('/', auth, async (req) => {
    const meId = req.user.sub
    const friends = await friendIds(meId)
    const stories = await Story.find({ author: { $in: [meId, ...friends] }, expiresAt: { $gt: new Date() } })
      .sort({ createdAt: 1 }).populate('author', PUBLIC_FIELDS).lean()

    const byAuthor = new Map()
    for (const s of stories) {
      if (!s.author) continue
      const key = s.author._id.toString()
      if (!byAuthor.has(key)) byAuthor.set(key, { author: s.author, own: key === meId, stories: [] })
      byAuthor.get(key).stories.push(serialize(s, req, meId))
    }
    const groups = [...byAuthor.values()].map(g => ({ ...g, seen: g.stories.every(s => s.seen) }))
    groups.sort((a, b) => (b.own - a.own) || (a.seen - b.seen))
    return { data: groups }
  })

  // GET /api/stories/user/:userId — storie attive di un autore (se visibili a me)
  app.get('/user/:userId', auth, async (req) => {
    const meId = req.user.sub
    const friends = await friendIds(meId)
    const stories = await Story.find({ author: req.params.userId, expiresAt: { $gt: new Date() } })
      .sort({ createdAt: 1 }).populate('author', PUBLIC_FIELDS).lean()
    const visible = []
    for (const s of stories) if (await canSee(s, meId, friends)) visible.push(serialize(s, req, meId))
    const author = stories[0]?.author || null
    return { data: { author, stories: visible } }
  })

  // POST /api/stories — crea la storia (poi si carica il media con /:id/media)
  app.post('/', auth, async (req, reply) => {
    const meId = req.user.sub
    const { audience = 'friends', stickers = [] } = req.body || {}
    if (!['all', 'friends'].includes(audience)) return reply.status(400).send({ error: 'Pubblico non valido' })
    const built = []
    for (const raw of Array.isArray(stickers) ? stickers.slice(0, 4) : []) {
      const sticker = await buildSticker(meId, raw)
      if (sticker) built.push(sticker)
    }
    const story = await new Story({ author: meId, audience, stickers: built, expiresAt: new Date(Date.now() + TTL_MS) }).save()
    return reply.status(201).send(serialize(story.toObject(), req, meId))
  })

  // POST /api/stories/:id/media — foto o video della storia (solo autore)
  app.post('/:id/media', auth, async (req, reply) => {
    const story = await Story.findOne({ _id: req.params.id, author: req.user.sub })
    if (!story) return reply.status(404).send({ error: 'Storia non trovata' })
    await fs.mkdir(uploadsDir(), { recursive: true })
    for await (const part of req.parts()) {
      if (part.type !== 'file') continue
      const mediaType = ALLOWED_MIME[part.mimetype]
      if (!mediaType) { await part.file.resume(); continue }
      const ext = path.extname(part.filename) || (mediaType === 'photo' ? '.jpg' : '.mp4')
      const filename = `${nanoid()}_${Date.now()}${ext}`
      const buffer = await part.toBuffer()
      await fs.writeFile(path.join(uploadsDir(), filename), buffer)
      if (story.media?.filename) { try { await fs.unlink(path.join(uploadsDir(), story.media.filename)) } catch {} }
      story.media = { filename, originalName: part.filename, mimetype: part.mimetype, size: buffer.length, type: mediaType }
      break
    }
    await story.save()
    return serialize(story.toObject(), req, req.user.sub)
  })

  // POST /api/stories/:id/view — segna la storia come vista (una volta per utente)
  app.post('/:id/view', auth, async (req, reply) => {
    const meId = req.user.sub
    const story = await Story.findOne({ _id: req.params.id, expiresAt: { $gt: new Date() } })
    if (!story) return reply.status(404).send({ error: 'Storia non trovata' })
    if (!await canSee(story, meId, await friendIds(meId))) return reply.status(403).send({ error: 'Permesso negato' })
    if (story.author.toString() !== meId) {
      // Atomico: una sola visualizzazione per utente anche con richieste concorrenti.
      await Story.updateOne({ _id: story._id, 'views.user': { $ne: meId } }, { $push: { views: { user: meId, at: new Date() } } })
    }
    return { ok: true }
  })

  // POST /api/stories/:id/like — mette/toglie il cuore
  app.post('/:id/like', auth, async (req, reply) => {
    const meId = req.user.sub
    const story = await Story.findOne({ _id: req.params.id, expiresAt: { $gt: new Date() } })
    if (!story) return reply.status(404).send({ error: 'Storia non trovata' })
    if (!await canSee(story, meId, await friendIds(meId))) return reply.status(403).send({ error: 'Permesso negato' })
    const has = story.likes.some(u => u.toString() === meId)
    story.likes = has ? story.likes.filter(u => u.toString() !== meId) : [...story.likes, meId]
    await story.save()
    return { liked: !has }
  })

  // DELETE /api/stories/:id — solo l'autore
  app.delete('/:id', auth, async (req, reply) => {
    const story = await Story.findOne({ _id: req.params.id, author: req.user.sub })
    if (!story) return reply.status(404).send({ error: 'Storia non trovata' })
    if (story.media?.filename) { try { await fs.unlink(path.join(uploadsDir(), story.media.filename)) } catch {} }
    await story.deleteOne()
    return { deleted: true }
  })
}
