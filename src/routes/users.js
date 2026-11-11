import mongoose from 'mongoose'
import User from '../models/User.js'
import Session from '../models/Session.js'
import Friendship from '../models/Friendship.js'
import { escapeRegExp } from '../utils/regex.js'
import { visibilityFilter } from '../utils/sessionAccess.js'
import { userCatches, periodRange, SORTS } from '../utils/userCatches.js'

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

  // GET /api/users/me/stats — numeri della propria bacheca (uscite, catture, amici).
  // Definita prima di /:id per non essere scambiata per un id.
  app.get('/me/stats', auth, async (req) => {
    const userId = new mongoose.Types.ObjectId(req.user.sub)
    const [agg] = await Session.aggregate([
      { $match: { userId, hidden: { $ne: true } } },
      { $group: { _id: null, sessionsCount: { $sum: 1 }, catchesCount: { $sum: { $size: { $ifNull: ['$catches', []] } } } } }
    ])
    const friendsCount = await Friendship.countDocuments({ status: 'accepted', $or: [{ requester: userId }, { recipient: userId }] })
    return { sessionsCount: agg?.sessionsCount || 0, catchesCount: agg?.catchesCount || 0, friendsCount }
  })

  // GET /api/users/:id — profilo pubblico di un altro utente
  app.get('/:id', auth, async (req, reply) => {
    if (!mongoose.isValidObjectId(req.params.id)) return reply.status(404).send({ error: 'Utente non trovato' })
    const user = await User.findById(req.params.id).select('displayName avatar username bio location createdAt').lean()
    if (!user) return reply.status(404).send({ error: 'Utente non trovato' })

    // Contatori del profilo: uscite visibili a chi guarda, catture in quelle uscite, amici.
    const visibility = await visibilityFilter(req.user)
    const [sess, friendsCount] = await Promise.all([
      Session.aggregate([
        { $match: { $and: [{ userId: new mongoose.Types.ObjectId(req.params.id) }, visibility] } },
        { $group: { _id: null, sessions: { $sum: 1 }, catches: { $sum: { $size: { $ifNull: ['$catches', []] } } } } }
      ]),
      Friendship.countDocuments({
        status: 'accepted',
        $or: [{ requester: req.params.id }, { recipient: req.params.id }]
      })
    ])
    // `stats` (solo uscite pubbliche) è quello già usato dal profilo; `counts` segue la visibilità di chi guarda.
    const [pub] = await Session.aggregate([
      { $match: { userId: user._id, visibility: 'users', hidden: false } },
      { $group: { _id: null, sessionsCount: { $sum: 1 }, catchesCount: { $sum: { $size: { $ifNull: ['$catches', []] } } } } }
    ])
    return { ...user, stats: { sessionsCount: pub?.sessionsCount || 0, catchesCount: pub?.catchesCount || 0 }, counts: { sessions: sess[0]?.sessions || 0, catches: sess[0]?.catches || 0, friends: friendsCount } }
  })

  // GET /api/users/:id/catches?sort=weight|length|species&species=&period=all|30d|YYYY&page=
  // Classifica delle catture di un utente con record e totali. La privacy è
  // quella delle uscite: di un altro utente si vedono solo le catture di
  // uscite visibili a chi guarda (pubbliche agli utenti, o di gruppi in comune).
  app.get('/:id/catches', auth, async (req, reply) => {
    const { id } = req.params
    const { sort = 'weight', species = '', period = 'all' } = req.query
    const page = Number.parseInt(req.query.page ?? '1', 10)

    if (!mongoose.isValidObjectId(id)) return reply.status(404).send({ error: 'Utente non trovato' })
    if (!SORTS.includes(sort)) return reply.status(400).send({ error: 'sort non valido' })
    if (periodRange(period) === null) return reply.status(400).send({ error: 'period non valido' })
    if (!Number.isInteger(page) || page < 1) return reply.status(400).send({ error: 'page non valida' })

    const user = await User.findById(id).select('displayName avatar').lean()
    if (!user) return reply.status(404).send({ error: 'Utente non trovato' })

    const visibility = await visibilityFilter(req.user)
    const baseUrl = `${req.protocol}://${req.headers.host}`
    const result = await userCatches({ userId: id, visibility, sort, species, period, page, baseUrl })
    return { user: { _id: user._id, displayName: user.displayName, avatar: user.avatar }, isSelf: id === req.user.sub, ...result }
  })
}
