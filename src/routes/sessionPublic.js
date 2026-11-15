import { createHash } from 'node:crypto'
import AppConfig from '../config.js'
import Session from '../models/Session.js'
import User from '../models/User.js'
import { SHARE_TOKEN_RE, publicSessionView, renderSharePage, clientShareUrl } from '../utils/sessionShare.js'

const CLIENT_URL = new AppConfig().get('client.url')

// Vista pubblica di sola lettura di un'uscita, raggiungibile solo con il link
// creato dall'autore. Token inesistente, revocato o uscita nascosta: stesso 404.
export default async function sessionPublicRoutes(app) {
  const rl = { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }

  async function load(token, req) {
    if (!SHARE_TOKEN_RE.test(String(token || ''))) return null
    const session = await Session.findOne({ shareToken: token, hidden: { $ne: true } }).lean()
    if (!session) return null
    const author = session.userId ? await User.findById(session.userId).select('displayName').lean() : null
    return publicSessionView(session, author, `${req.protocol}://${req.headers.host}`)
  }

  app.get('/:token', rl, async (req, reply) => {
    const view = await load(req.params.token, req)
    if (!view) return reply.status(404).send({ error: 'Link non valido' })
    const etag = '"' + createHash('sha1').update(JSON.stringify(view)).digest('hex') + '"'
    reply.header('Cache-Control', 'public, max-age=60').header('ETag', etag)
    if (req.headers['if-none-match'] === etag) return reply.status(304).send()
    return view
  })

  // Pagina con anteprima Open Graph (per WhatsApp, Telegram...) che rimanda al client.
  app.get('/:token/page', rl, async (req, reply) => {
    const view = await load(req.params.token, req)
    if (!view) return reply.status(404).type('text/plain').send('Link non valido')
    return reply.type('text/html; charset=utf-8').header('Cache-Control', 'public, max-age=60')
      .send(renderSharePage(view, clientShareUrl(CLIENT_URL, req.params.token)))
  })
}
