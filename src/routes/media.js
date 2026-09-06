import fs from 'fs/promises'
import path from 'path'
import { nanoid } from 'nanoid'
import Session from '../models/Session.js'
import Post from '../models/Post.js'
import AppConfig from '../config.js'
import { canEdit } from '../utils/sessionAccess.js'
import { canEdit as canEditPost } from '../utils/postAccess.js'

const cfg = new AppConfig()

const ALLOWED_MIME = {
  'image/jpeg':     'photo',
  'image/png':      'photo',
  'image/webp':     'photo',
  'image/heic':     'photo',
  'video/mp4':      'video',
  'video/quicktime':'video',
  'video/x-msvideo':'video'
}

function uploadsDir() {
  return path.resolve(cfg.get('app.dirs.uploads'))
}

// Risolve l'array di media su cui operare: quello della sessione, oppure
// quello di una specifica cattura quando è passato un catchId.
function resolveTarget(session, catchId, reply) {
  if (!catchId) return session.media
  const c = session.catches.id(catchId)
  if (!c) { reply.status(404).send({ error: 'Cattura non trovata' }); return null }
  return c.media
}

export default async function mediaRoutes(app) {

  const auth = { preHandler: [app.authenticate] }

  async function handleUpload(req, reply, catchId) {
    const session = await Session.findById(req.params.sessionId)
    if (!session) return reply.status(404).send({ error: 'Session not found' })
    if (!canEdit(req.user, session)) return reply.status(403).send({ error: 'Permesso negato' })

    const target = resolveTarget(session, catchId, reply)
    if (!target) return

    await fs.mkdir(uploadsDir(), { recursive: true })

    const uploaded = []
    const parts = req.parts()

    for await (const part of parts) {
      if (part.type !== 'file') continue
      const mediaType = ALLOWED_MIME[part.mimetype]
      if (!mediaType) { await part.file.resume(); continue }

      const ext = path.extname(part.filename) || (mediaType === 'photo' ? '.jpg' : '.mp4')
      const filename = `${nanoid()}_${Date.now()}${ext}`
      const filepath = path.join(uploadsDir(), filename)

      const buffer = await part.toBuffer()
      await fs.writeFile(filepath, buffer)

      const doc = {
        filename,
        originalName: part.filename,
        mimetype: part.mimetype,
        size: buffer.length,
        type: mediaType,
        caption: ''
      }
      target.push(doc)
      uploaded.push(doc)
    }

    await session.save()

    const baseUrl = `${req.protocol}://${req.headers.host}`
    return reply.send({
      uploaded: uploaded.map(m => ({ ...m, url: `${baseUrl}/uploads/${m.filename}` }))
    })
  }

  // POST /api/media/upload/:sessionId — media della sessione
  app.post('/upload/:sessionId', auth, (req, reply) => handleUpload(req, reply, null))

  // POST /api/media/upload/:sessionId/catch/:catchId — foto/video di una cattura
  app.post('/upload/:sessionId/catch/:catchId', auth, (req, reply) => handleUpload(req, reply, req.params.catchId))

  async function handleDelete(req, reply, catchId) {
    const session = await Session.findById(req.params.sessionId)
    if (!session) return reply.status(404).send({ error: 'Session not found' })
    if (!canEdit(req.user, session)) return reply.status(403).send({ error: 'Permesso negato' })

    const target = resolveTarget(session, catchId, reply)
    if (!target) return

    const item = target.id(req.params.mediaId)
    if (!item) return reply.status(404).send({ error: 'Media not found' })

    try { await fs.unlink(path.join(uploadsDir(), item.filename)) } catch {}

    item.deleteOne()
    await session.save()
    return { deleted: true }
  }

  // DELETE /api/media/:sessionId/:mediaId
  app.delete('/:sessionId/:mediaId', auth, (req, reply) => handleDelete(req, reply, null))

  // DELETE /api/media/:sessionId/catch/:catchId/:mediaId
  app.delete('/:sessionId/catch/:catchId/:mediaId', auth, (req, reply) => handleDelete(req, reply, req.params.catchId))

  async function handleCaption(req, reply, catchId) {
    const session = await Session.findById(req.params.sessionId)
    if (!session) return reply.status(404).send({ error: 'Session not found' })
    if (!canEdit(req.user, session)) return reply.status(403).send({ error: 'Permesso negato' })

    const target = resolveTarget(session, catchId, reply)
    if (!target) return

    const item = target.id(req.params.mediaId)
    if (!item) return reply.status(404).send({ error: 'Media not found' })

    item.caption = req.body.caption || ''
    await session.save()
    return { updated: true }
  }

  // PATCH /api/media/:sessionId/:mediaId/caption
  app.patch('/:sessionId/:mediaId/caption', auth, (req, reply) => handleCaption(req, reply, null))

  // PATCH /api/media/:sessionId/catch/:catchId/:mediaId/caption
  app.patch('/:sessionId/catch/:catchId/:mediaId/caption', auth, (req, reply) => handleCaption(req, reply, req.params.catchId))

  // ─── Media sui post/eventi ──────────────────────────────────────────────────

  async function writeUploadedFiles(req, target) {
    await fs.mkdir(uploadsDir(), { recursive: true })

    const uploaded = []
    for await (const part of req.parts()) {
      if (part.type !== 'file') continue
      const mediaType = ALLOWED_MIME[part.mimetype]
      if (!mediaType) { await part.file.resume(); continue }

      const ext = path.extname(part.filename) || (mediaType === 'photo' ? '.jpg' : '.mp4')
      const filename = `${nanoid()}_${Date.now()}${ext}`
      const filepath = path.join(uploadsDir(), filename)

      const buffer = await part.toBuffer()
      await fs.writeFile(filepath, buffer)

      const doc = {
        filename,
        originalName: part.filename,
        mimetype: part.mimetype,
        size: buffer.length,
        type: mediaType,
        caption: ''
      }
      target.push(doc)
      uploaded.push(doc)
    }
    return uploaded
  }

  // POST /api/media/upload/post/:postId
  app.post('/upload/post/:postId', auth, async (req, reply) => {
    const post = await Post.findById(req.params.postId)
    if (!post) return reply.status(404).send({ error: 'Post non trovato' })
    if (!canEditPost(req.user, post)) return reply.status(403).send({ error: 'Permesso negato' })

    const uploaded = await writeUploadedFiles(req, post.media)
    await post.save()

    const baseUrl = `${req.protocol}://${req.headers.host}`
    return reply.send({ uploaded: uploaded.map(m => ({ ...m, url: `${baseUrl}/uploads/${m.filename}` })) })
  })

  // DELETE /api/media/post/:postId/:mediaId
  app.delete('/post/:postId/:mediaId', auth, async (req, reply) => {
    const post = await Post.findById(req.params.postId)
    if (!post) return reply.status(404).send({ error: 'Post non trovato' })
    if (!canEditPost(req.user, post)) return reply.status(403).send({ error: 'Permesso negato' })

    const item = post.media.id(req.params.mediaId)
    if (!item) return reply.status(404).send({ error: 'Media not found' })

    try { await fs.unlink(path.join(uploadsDir(), item.filename)) } catch {}

    item.deleteOne()
    await post.save()
    return { deleted: true }
  })

  // PATCH /api/media/post/:postId/:mediaId/caption
  app.patch('/post/:postId/:mediaId/caption', auth, async (req, reply) => {
    const post = await Post.findById(req.params.postId)
    if (!post) return reply.status(404).send({ error: 'Post non trovato' })
    if (!canEditPost(req.user, post)) return reply.status(403).send({ error: 'Permesso negato' })

    const item = post.media.id(req.params.mediaId)
    if (!item) return reply.status(404).send({ error: 'Media not found' })

    item.caption = req.body.caption || ''
    await post.save()
    return { updated: true }
  })
}
