import Post from '../models/Post.js'
import Group from '../models/Group.js'
import User from '../models/User.js'
import { visibilityFilter, canEdit } from '../utils/postAccess.js'
import { distanceKm } from '../utils/geo.js'

export default async function postRoutes(app) {

  const auth = { preHandler: [app.authenticate] }

  // GET /api/posts/unread-count — badge bacheca: nuovi post nel feed generale
  // dall'ultima visita (esclusi i propri) + risposte ricevute sui propri
  // eventi dall'ultima visita a "La mia bacheca" (escluse le proprie risposte).
  app.get('/unread-count', auth, async (req) => {
    const userId = req.user.sub
    const user = await User.findById(userId).select('lastSeenFeedAt lastSeenBoardAt').lean()

    const filter = await visibilityFilter(req.user)
    const feedFilter = {
      ...filter,
      author: { $ne: userId },
      createdAt: { $gt: user.lastSeenFeedAt }
    }

    const [feed, board] = await Promise.all([
      Post.countDocuments(feedFilter),
      Post.countDocuments({
        author: userId,
        type: 'event',
        responses: { $elemMatch: { user: { $ne: userId }, createdAt: { $gt: user.lastSeenBoardAt } } }
      })
    ])

    return { feed, board }
  })

  // POST /api/posts/mark-seen — segna come vista la bacheca generale o la propria
  app.post('/mark-seen', auth, async (req, reply) => {
    const { scope } = req.body
    if (!['feed', 'board'].includes(scope)) return reply.status(400).send({ error: 'Scope non valido' })

    const field = scope === 'feed' ? 'lastSeenFeedAt' : 'lastSeenBoardAt'
    await User.findByIdAndUpdate(req.user.sub, { [field]: new Date() })
    return { ok: true }
  })

  // GET /api/posts — bacheca generale, filtrabile per tipo/visibilità/data/autore/gruppo
  // e, per gli eventi, per vicinanza geografica (con relativo ordinamento).
  app.get('/', auth, async (req) => {
    const {
      page = 1, limit = 20, author, group, type, visibility,
      dateFrom, dateTo, near, radiusKm, sort
    } = req.query
    const filter = await visibilityFilter(req.user)

    if (author) filter.author = author
    if (group) {
      filter.visibility = 'group'
      filter.allowedGroups = group
    }
    if (['post', 'event'].includes(type)) filter.type = type
    if (['public', 'group', 'private'].includes(visibility)) filter.visibility = visibility

    const dateField = type === 'event' ? 'event.date' : 'createdAt'
    if (dateFrom || dateTo) {
      filter[dateField] = {}
      if (dateFrom) filter[dateField].$gte = new Date(dateFrom)
      if (dateTo) filter[dateField].$lte = new Date(`${dateTo}T23:59:59.999`)
    }

    let nearCoords = null
    if (type === 'event' && near) {
      const [lat, lng] = String(near).split(',').map(Number)
      if (!Number.isNaN(lat) && !Number.isNaN(lng)) nearCoords = { lat, lng }
    }

    const pageNum  = parseInt(page)
    const limitNum = parseInt(limit)

    const populatePost = (q) => q
      .populate('author', 'displayName avatar')
      .populate('allowedGroups', 'name')
      .populate('comments.user', 'displayName avatar')
      .populate('responses.user', 'displayName avatar')
      .populate('event.attendees.user', 'displayName avatar')
      .lean()

    // Filtro/ordinamento per vicinanza: le coordinate non sono un indice geo,
    // quindi calcoliamo la distanza in memoria su tutti i match e pagina qui.
    if (nearCoords) {
      const all = await populatePost(Post.find(filter))
      const radius = radiusKm ? parseFloat(radiusKm) : null

      let withDistance = all
        .map(p => ({ ...p, distanceKm: distanceKm(nearCoords, p.event?.location) }))
        .filter(p => p.distanceKm != null && (!radius || p.distanceKm <= radius))

      withDistance.sort(sort === 'date'
        ? (a, b) => new Date(a.event?.date || 0) - new Date(b.event?.date || 0)
        : (a, b) => a.distanceKm - b.distanceKm)

      const total = withDistance.length
      const skip = (pageNum - 1) * limitNum
      const posts = withDistance.slice(skip, skip + limitNum)

      return { data: posts, pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) } }
    }

    const sortSpec = type === 'event' && sort === 'date' ? { 'event.date': 1 } : { createdAt: -1 }

    const skip = (pageNum - 1) * limitNum
    const [posts, total] = await Promise.all([
      populatePost(Post.find(filter).sort(sortSpec).skip(skip).limit(limitNum)),
      Post.countDocuments(filter)
    ])

    return { data: posts, pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) } }
  })

  // POST /api/posts — crea post/evento
  app.post('/', auth, async (req, reply) => {
    const { type, visibility, allowedGroups, title, body, event } = req.body
    if (!body) return reply.status(400).send({ error: 'Testo obbligatorio' })

    if (visibility === 'group') {
      if (!allowedGroups?.length) return reply.status(400).send({ error: 'Gruppo obbligatorio' })
      const groups = await Group.find({
        _id: { $in: allowedGroups },
        $or: [{ owner: req.user.sub }, { members: req.user.sub }]
      }).select('_id')
      if (groups.length !== allowedGroups.length) return reply.status(403).send({ error: 'Non appartieni a uno dei gruppi indicati' })
    }

    const post = new Post({
      author: req.user.sub,
      type: type === 'event' ? 'event' : 'post',
      visibility: visibility || 'public',
      allowedGroups: visibility === 'group' ? allowedGroups : [],
      title,
      body,
      event: type === 'event' ? event : undefined
    })
    await post.save()
    await post.populate('author', 'displayName avatar')
    return reply.status(201).send(post)
  })

  // GET /api/posts/:id
  app.get('/:id', auth, async (req, reply) => {
    const filter = await visibilityFilter(req.user)
    const post = await Post.findOne({ _id: req.params.id, ...filter })
      .populate('author', 'displayName avatar')
      .populate('allowedGroups', 'name')
      .populate('responses.user', 'displayName avatar')
      .populate('comments.user', 'displayName avatar')
      .populate('event.attendees.user', 'displayName avatar')
      .lean()
    if (!post) return reply.status(404).send({ error: 'Post non trovato o non accessibile' })
    return post
  })

  // PATCH /api/posts/:id — modifica (solo author/admin)
  app.patch('/:id', auth, async (req, reply) => {
    const post = await Post.findById(req.params.id)
    if (!post) return reply.status(404).send({ error: 'Post non trovato' })
    if (!canEdit(req.user, post)) return reply.status(403).send({ error: 'Permesso negato' })

    const { title, body, event } = req.body
    if (title !== undefined) post.title = title
    if (body) post.body = body
    if (event && post.type === 'event') post.event = { ...post.event?.toObject?.(), ...event }
    await post.save()
    return post
  })

  // DELETE /api/posts/:id — solo author/admin
  app.delete('/:id', auth, async (req, reply) => {
    const post = await Post.findById(req.params.id)
    if (!post) return reply.status(404).send({ error: 'Post non trovato' })
    if (!canEdit(req.user, post)) return reply.status(403).send({ error: 'Permesso negato' })

    await post.deleteOne()
    return { deleted: true }
  })

  // POST /api/posts/:id/responses — risponde a un evento
  app.post('/:id/responses', auth, async (req, reply) => {
    const filter = await visibilityFilter(req.user)
    const post = await Post.findOne({ _id: req.params.id, ...filter })
    if (!post) return reply.status(404).send({ error: 'Post non trovato o non accessibile' })
    if (post.type !== 'event') return reply.status(400).send({ error: 'Solo gli eventi accettano risposte' })
    if (post.event?.status !== 'open') return reply.status(400).send({ error: 'Evento chiuso' })

    const { message } = req.body
    if (!message) return reply.status(400).send({ error: 'Messaggio obbligatorio' })

    post.responses.push({ user: req.user.sub, message })
    await post.save()
    await post.populate('responses.user', 'displayName avatar')
    return reply.status(201).send(post.responses[post.responses.length - 1])
  })

  // POST /api/posts/:id/attendance — partecipo/forse/non partecipo (+ ospiti) a un evento
  app.post('/:id/attendance', auth, async (req, reply) => {
    const filter = await visibilityFilter(req.user)
    const post = await Post.findOne({ _id: req.params.id, ...filter })
    if (!post) return reply.status(404).send({ error: 'Post non trovato o non accessibile' })
    if (post.type !== 'event') return reply.status(400).send({ error: 'Solo gli eventi accettano adesioni' })
    if (post.event?.status !== 'open') return reply.status(400).send({ error: 'Evento chiuso' })

    const { status, guests } = req.body
    if (!['going', 'maybe', 'not_going'].includes(status)) return reply.status(400).send({ error: 'Stato non valido' })
    const guestCount = Math.max(0, parseInt(guests, 10) || 0)

    const existing = post.event.attendees.find(a => a.user.toString() === req.user.sub)
    if (existing) {
      existing.status = status
      existing.guests = guestCount
    } else {
      post.event.attendees.push({ user: req.user.sub, status, guests: guestCount })
    }
    await post.save()
    await post.populate('event.attendees.user', 'displayName avatar')
    await post.populate('author', 'displayName avatar')
    return post
  })

  // POST /api/posts/:id/comments — commenta un post (qualunque tipo)
  app.post('/:id/comments', auth, async (req, reply) => {
    const filter = await visibilityFilter(req.user)
    const post = await Post.findOne({ _id: req.params.id, ...filter })
    if (!post) return reply.status(404).send({ error: 'Post non trovato o non accessibile' })

    const { message } = req.body
    if (!message?.trim()) return reply.status(400).send({ error: 'Messaggio obbligatorio' })

    post.comments.push({ user: req.user.sub, message: message.trim() })
    await post.save()
    await post.populate('comments.user', 'displayName avatar')
    return reply.status(201).send(post.comments[post.comments.length - 1])
  })

  // DELETE /api/posts/:id/comments/:commentId — solo autore del commento, dell'post o admin
  app.delete('/:id/comments/:commentId', auth, async (req, reply) => {
    const post = await Post.findById(req.params.id)
    if (!post) return reply.status(404).send({ error: 'Post non trovato' })

    const comment = post.comments.id(req.params.commentId)
    if (!comment) return reply.status(404).send({ error: 'Commento non trovato' })

    const isCommentAuthor = comment.user.toString() === req.user.sub
    if (!isCommentAuthor && !canEdit(req.user, post)) return reply.status(403).send({ error: 'Permesso negato' })

    comment.deleteOne()
    await post.save()
    return { deleted: true }
  })

  // POST /api/posts/:id/like — mette/toglie "mi piace" (toggle)
  app.post('/:id/like', auth, async (req, reply) => {
    const filter = await visibilityFilter(req.user)
    const post = await Post.findOne({ _id: req.params.id, ...filter })
    if (!post) return reply.status(404).send({ error: 'Post non trovato o non accessibile' })

    const userId = req.user.sub
    const alreadyLiked = post.likes.some(id => id.toString() === userId)
    if (alreadyLiked) {
      post.likes = post.likes.filter(id => id.toString() !== userId)
    } else {
      post.likes.push(userId)
    }
    await post.save()
    return { liked: !alreadyLiked, count: post.likes.length }
  })

  // PATCH /api/posts/:id/status — apre/chiude un evento (solo author)
  app.patch('/:id/status', auth, async (req, reply) => {
    const post = await Post.findById(req.params.id)
    if (!post) return reply.status(404).send({ error: 'Post non trovato' })
    if (post.type !== 'event') return reply.status(400).send({ error: 'Solo gli eventi hanno uno stato' })
    if (!canEdit(req.user, post)) return reply.status(403).send({ error: 'Permesso negato' })

    const { status } = req.body
    if (!['open', 'closed'].includes(status)) return reply.status(400).send({ error: 'Stato non valido' })

    post.event.status = status
    await post.save()
    return post
  })
}
