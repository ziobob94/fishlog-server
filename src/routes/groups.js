import Group from '../models/Group.js'

export default async function groupRoutes(app) {

  const auth = { preHandler: [app.authenticate] }

  // GET /api/groups — gruppi di cui sono membro o owner
  app.get('/', auth, async (req) => {
    const userId = req.user.sub
    const groups = await Group.find({
      $or: [{ owner: userId }, { members: userId }]
    }).populate('owner', 'displayName email').lean()
    return groups
  })

  // POST /api/groups — crea gruppo
  app.post('/', auth, async (req, reply) => {
    const { name, description } = req.body
    if (!name) return reply.status(400).send({ error: 'Nome obbligatorio' })
    const group = new Group({ name, description, owner: req.user.sub, members: [req.user.sub] })
    await group.save()
    return reply.status(201).send(group)
  })

  // GET /api/groups/:id
  app.get('/:id', auth, async (req, reply) => {
    const group = await Group.findById(req.params.id)
      .populate('owner', 'displayName email avatar')
      .populate('members', 'displayName email avatar')
      .lean()
    if (!group) return reply.status(404).send({ error: 'Gruppo non trovato' })

    const userId = req.user.sub
    const isMember = group.members.some(m => m._id.toString() === userId)
    const isAdmin  = req.user.role === 'admin'
    if (!isMember && !isAdmin) return reply.status(403).send({ error: 'Accesso negato' })

    return group
  })

  // PATCH /api/groups/:id — modifica nome/descrizione (solo owner/admin)
  app.patch('/:id', auth, async (req, reply) => {
    const group = await Group.findById(req.params.id)
    if (!group) return reply.status(404).send({ error: 'Gruppo non trovato' })
    if (group.owner.toString() !== req.user.sub && req.user.role !== 'admin')
      return reply.status(403).send({ error: 'Permesso negato' })

    const { name, description } = req.body
    if (name) group.name = name
    if (description !== undefined) group.description = description
    await group.save()
    return group
  })

  // POST /api/groups/:id/members — aggiungi membro (solo owner/admin)
  app.post('/:id/members', auth, async (req, reply) => {
    const group = await Group.findById(req.params.id)
    if (!group) return reply.status(404).send({ error: 'Gruppo non trovato' })
    if (group.owner.toString() !== req.user.sub && req.user.role !== 'admin')
      return reply.status(403).send({ error: 'Permesso negato' })

    const { userId } = req.body
    if (!userId) return reply.status(400).send({ error: 'userId obbligatorio' })
    if (!group.members.map(String).includes(userId)) group.members.push(userId)
    await group.save()
    return { added: true }
  })

  // DELETE /api/groups/:id/members/:userId — rimuovi membro
  app.delete('/:id/members/:userId', auth, async (req, reply) => {
    const group = await Group.findById(req.params.id)
    if (!group) return reply.status(404).send({ error: 'Gruppo non trovato' })

    const isOwner = group.owner.toString() === req.user.sub
    const isAdmin = req.user.role === 'admin'
    const isSelf  = req.params.userId === req.user.sub

    if (!isOwner && !isAdmin && !isSelf) return reply.status(403).send({ error: 'Permesso negato' })
    if (req.params.userId === group.owner.toString()) return reply.status(400).send({ error: 'Il proprietario non può essere rimosso' })

    group.members = group.members.filter(m => m.toString() !== req.params.userId)
    await group.save()
    return { removed: true }
  })

  // DELETE /api/groups/:id — elimina gruppo (solo owner/admin)
  app.delete('/:id', auth, async (req, reply) => {
    const group = await Group.findById(req.params.id)
    if (!group) return reply.status(404).send({ error: 'Gruppo non trovato' })
    if (group.owner.toString() !== req.user.sub && req.user.role !== 'admin')
      return reply.status(403).send({ error: 'Permesso negato' })

    await group.deleteOne()
    return { deleted: true }
  })
}