import User from '../models/User.js'

export default async function userRoutes(app) {

  const auth = { preHandler: [app.authenticate] }

  // GET /api/users?search= — ricerca pubblica (per nome o email), usata per
  // trovare persone a cui inviare una richiesta d'amicizia o da aggiungere
  // a un gruppo. Espone solo i campi pubblici, mai passwordHash/email altrui
  // per intero: qui restituiamo comunque l'email per permettere una ricerca
  // esatta (serve al flusso "aggiungi membro per email" già in uso nei
  // gruppi), ma nessun altro dato sensibile.
  app.get('/', auth, async (req) => {
    const { search } = req.query
    if (!search || search.trim().length < 2) return { data: [] }

    const users = await User.find({
      _id: { $ne: req.user.sub },
      $or: [{ email: new RegExp(search.trim(), 'i') }, { displayName: new RegExp(search.trim(), 'i') }]
    }).select('displayName email avatar').limit(20).lean()

    return { data: users }
  })

  // GET /api/users/:id — profilo pubblico di un altro utente
  app.get('/:id', auth, async (req, reply) => {
    const user = await User.findById(req.params.id).select('displayName avatar createdAt').lean()
    if (!user) return reply.status(404).send({ error: 'Utente non trovato' })
    return user
  })
}
