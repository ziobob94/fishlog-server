import AppConfig from './config.js'
const cfg = new AppConfig()

import Fastify from 'fastify'
import jwt from '@fastify/jwt'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import multipart from '@fastify/multipart'
import staticFiles from '@fastify/static'
import websocket from '@fastify/websocket'
import path from 'path'
import { fileURLToPath } from 'url'
import mongoose from 'mongoose'
import pretty from 'pino-pretty'
import authorizePlugin from './plugins/authorize.js'

import sessionRoutes from './routes/sessions.js'
import mediaRoutes   from './routes/media.js'
import authRoutes    from './routes/auth.js'
import groupRoutes     from './routes/groups.js'
import adminRoutes     from './routes/admin.js'
import speciesRoutes    from './routes/species.js'
import postRoutes       from './routes/posts.js'
import userRoutes       from './routes/users.js'
import friendRoutes     from './routes/friends.js'
import chatRoutes       from './routes/chat.js'
import notificationRoutes from './routes/notifications.js'
import listingRoutes    from './routes/listings.js'
import legalRoutes       from './routes/legal.js'
import ebayNotificationRoutes from './routes/ebayNotifications.js'
import fp from 'fastify-plugin'
import { registerConnection } from './ws/hub.js'
import { reloadRuntimeConfig, startPeriodicReload } from './runtimeConfigStore.js'
import { backfillDirectConversations } from './migrations/backfillConversationType.js'


const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Stream sincrono (no worker thread): il transport pino-pretty basato su
// worker crasha sotto `node --watch` (thread-stream orfano ai riavvii).
// trustProxy va a true in produzione quando il processo sta dietro un
// reverse proxy (nginx, load balancer): serve per ricavare l'IP reale del
// client (rate limiting, log) e per rilevare correttamente https.
const app = Fastify({
  trustProxy: cfg.get('api.trustProxy', false),
  logger: {
    stream: pretty({ colorize: true })
  }
})

// Header di sicurezza HTTP (HSTS, X-Content-Type-Options, Referrer-Policy...).
// CSP disattivata: questo processo espone solo API JSON e file statici
// (nessuna pagina HTML da proteggere da XSS). crossOriginResourcePolicy va
// a "cross-origin" perché il client Vue gira su un'origin diversa e deve
// poter caricare le immagini/i video in /uploads.
await app.register(helmet, {
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' }
})

// Rate limiting globale anti brute-force/DoS applicativo. Le rotte di auth
// (login, register, reset password...) applicano un limite più stretto,
// vedi routes/auth.js.
await app.register(rateLimit, {
  global: true,
  max: cfg.get('security.rateLimit.global.max', 200),
  timeWindow: cfg.get('security.rateLimit.global.timeWindow', '1 minute')
})

await app.register(cors, {
  origin: cfg.get('client.url'),
  methods: ['GET','POST','PUT','PATCH','DELETE'],
  credentials: true
})

await app.register(jwt, {
  secret: cfg.get('jwt.secret')
})

await app.register(cookie)

await app.register(multipart, {
  limits: { fileSize: 200 * 1024 * 1024, files: 20 }
})

const uploadsDir = path.resolve(cfg.get('app.dirs.uploads'))
await app.register(staticFiles, {
  root: uploadsDir,
  prefix: '/uploads/'
})


await app.register(fp(async (instance) => {
  instance.decorate('authenticate', async function (req, reply) {
    try {
      await req.jwtVerify()
    } catch {
      reply.status(401).send({ error: 'Non autenticato' })
    }
  })
}))

await app.register(authorizePlugin)

await app.register(websocket)

// Handshake WS autenticato via token in query string (i socket non passano
// comodamente header Authorization). Alla connessione, registra il socket
// nell'hub per l'invio realtime di notifiche/badge.
app.get('/api/ws', { websocket: true }, (connection, req) => {
  let userId
  try {
    const token = req.query?.token
    if (!token) throw new Error('missing token')
    userId = app.jwt.verify(token).sub
  } catch {
    connection.close(1008, 'Non autenticato')
    return
  }
  registerConnection(userId, connection)
})

await app.register(authRoutes,    { prefix: '/api/auth' })
await app.register(sessionRoutes, { prefix: '/api/sessions' })
await app.register(mediaRoutes,   { prefix: '/api/media' })
await app.register(groupRoutes,   { prefix: '/api/groups' })
await app.register(adminRoutes,   { prefix: '/api/admin' })
await app.register(speciesRoutes, { prefix: '/api/species' })
await app.register(postRoutes,    { prefix: '/api/posts' })
await app.register(userRoutes,    { prefix: '/api/users' })
await app.register(friendRoutes,  { prefix: '/api/friends' })
await app.register(chatRoutes,    { prefix: '/api/chat' })
await app.register(notificationRoutes, { prefix: '/api/notifications' })
await app.register(listingRoutes, { prefix: '/api/listings' })
await app.register(legalRoutes,   { prefix: '/api/legal' })
await app.register(ebayNotificationRoutes, { prefix: '/api/ebay' })

app.get('/api/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }))

// Handler globale: logga sempre lo stack completo lato server, ma verso il
// client espone il messaggio grezzo solo per errori applicativi noti
// (statusCode < 500). Per i 500 (bug/eccezioni impreviste) risponde con un
// messaggio generico per non far trapelare stack trace o dettagli interni.
app.setErrorHandler((err, req, reply) => {
  const statusCode = err.statusCode || 500
  req.log.error({ err }, 'request error')
  if (statusCode >= 500) {
    return reply.status(statusCode).send({ error: 'Errore interno del server' })
  }
  return reply.status(statusCode).send({ error: err.message || 'Richiesta non valida' })
})

try {
  await mongoose.connect(cfg.get('mongodb.url'))
  app.log.info('MongoDB connected')
} catch (err) {
  app.log.error({ err }, 'MongoDB connection failed')
  process.exit(1)
}

try {
  await backfillDirectConversations(app.log)
} catch (err) {
  app.log.error({ err }, 'Backfill conversazioni dirette fallito')
}

// Configurazioni modificabili da admin (eBay, OAuth, SMTP, feature flag...):
// caricate ora che il DB è connesso, poi rilette periodicamente così un
// salvataggio da un altro processo (PM2 cluster) arriva senza riavvio.
await reloadRuntimeConfig()
startPeriodicReload()

await app.listen({ port: cfg.get('api.port'), host: cfg.get('api.host') });