import User from '../models/User.js'
import Session from '../models/Session.js'
import { escapeRegExp } from '../utils/regex.js'

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

    const re = new RegExp(escapeRegExp(search.trim()), 'i')
    const users = await User.find({
      _id: { $ne: req.user.sub },
      $or: [{ email: re }, { displayName: re }]
    }).select('displayName email avatar').limit(20).lean()

    return { data: users }
  })

  // GET /api/users/:id — profilo pubblico di un altro utente
  app.get('/:id', auth, async (req, reply) => {
    const user = await User.findById(req.params.id).select('displayName avatar createdAt').lean()
    if (!user) return reply.status(404).send({ error: 'Utente non trovato' })
    // Statistiche pubbliche: solo uscite già visibili a tutti (visibility
    // 'users', non nascoste), come nella classifica. Nessun dato privato.
    const [agg] = await Session.aggregate([
      { $match: { userId: user._id, visibility: 'users', hidden: false } },
      { $group: { _id: null, sessionsCount: { $sum: 1 }, catchesCount: { $sum: { $size: { $ifNull: ['$catches', []] } } } } }
    ])
    return { ...user, stats: { sessionsCount: agg?.sessionsCount || 0, catchesCount: agg?.catchesCount || 0 } }
  })
}
