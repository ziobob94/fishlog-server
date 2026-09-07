import AppConfig from './config.js'
const cfg = new AppConfig()

import Fastify from 'fastify'
import jwt from '@fastify/jwt'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
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
import fp from 'fastify-plugin'
import { registerConnection } from './ws/hub.js'


const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Stream sincrono (no worker thread): il transport pino-pretty basato su
// worker crasha sotto `node --watch` (thread-stream orfano ai riavvii).
const app = Fastify({
  logger: {
    stream: pretty({ colorize: true })
  }
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

app.get('/api/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }))

try {
  await mongoose.connect(cfg.get('mongodb.url'))
  app.log.info('MongoDB connected')
} catch (err) {
  app.log.error({ err }, 'MongoDB connection failed')
  process.exit(1)
}

await app.listen({ port: cfg.get('api.port'), host: cfg.get('api.host') });