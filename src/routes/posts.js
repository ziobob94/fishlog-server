import Post from '../models/Post.js'
import Group from '../models/Group.js'
import User from '../models/User.js'
import { visibilityFilter, canEdit } from '../utils/postAccess.js'

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

  // GET /api/posts — bacheca generale, o filtrata per author/group
  app.get('/', auth, async (req) => {
    const { page = 1, limit = 20, author, group } = req.query
    const filter = await visibilityFilter(req.user)

    if (author) filter.author = author
    if (group) {
      filter.visibility = 'group'
      filter.allowedGroups = group
    }

    const skip = (parseInt(page) - 1) * parseInt(limit)
    const [posts, total] = await Promise.all([
      Post.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip).limit(parseInt(limit))
        .populate('author', 'displayName avatar')
        .populate('allowedGroups', 'name')
        .lean(),
      Post.countDocuments(filter)
    ])

    return { data: posts, pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) } }
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
