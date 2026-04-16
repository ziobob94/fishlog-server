import fs from 'fs/promises'
import path from 'path'
import { nanoid } from 'nanoid'
import Session from '../models/Session.js'

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
  return path.resolve(process.env.UPLOADS_DIR || './uploads')
}

export default async function mediaRoutes(app) {

  // POST /api/media/upload/:sessionId
  app.post('/upload/:sessionId', async (req, reply) => {
    const session = await Session.findById(req.params.sessionId)
    if (!session) return reply.status(404).send({ error: 'Session not found' })

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
      session.media.push(doc)
      uploaded.push(doc)
    }

    await session.save()

    const baseUrl = `${req.protocol}://${req.hostname}:${process.env.PORT || 3001}`
    return {
      uploaded: uploaded.map(m => ({ ...m, url: `${baseUrl}/uploads/${m.filename}` }))
    }
  })

  // DELETE /api/media/:sessionId/:mediaId
  app.delete('/:sessionId/:mediaId', async (req, reply) => {
    const session = await Session.findById(req.params.sessionId)
    if (!session) return reply.status(404).send({ error: 'Session not found' })

    const item = session.media.id(req.params.mediaId)
    if (!item) return reply.status(404).send({ error: 'Media not found' })

    try { await fs.unlink(path.join(uploadsDir(), item.filename)) } catch {}

    item.deleteOne()
    await session.save()
    return { deleted: true }
  })

  // PATCH /api/media/:sessionId/:mediaId/caption
  app.patch('/:sessionId/:mediaId/caption', async (req, reply) => {
    const session = await Session.findById(req.params.sessionId)
    if (!session) return reply.status(404).send({ error: 'Session not found' })

    const item = session.media.id(req.params.mediaId)
    if (!item) return reply.status(404).send({ error: 'Media not found' })

    item.caption = req.body.caption || ''
    await session.save()
    return { updated: true }
  })
}
