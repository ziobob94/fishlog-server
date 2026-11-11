import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'
import mongoose from 'mongoose'
import Session from '../models/Session.js'
import User from '../models/User.js'
import { visibilityFilter, canEdit, canModerate } from '../utils/sessionAccess.js'
import { escapeRegExp } from '../utils/regex.js'

// Catalogo di esche note (naturali/artificiali/miste), usato come base di
// suggerimenti finché non c'è storico personale, e per proporre il "tipo"
// quando l'utente sceglie un'esca standard.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BAIT_CATALOG = JSON.parse(readFileSync(path.join(__dirname, '../data/baits.json'), 'utf-8'))

// Record personale: la cattura più lunga dell'uscita è la più lunga di quella
// specie tra tutte le uscite dell'autore (a parità vale la prima in ordine di
// data). Restituisce { species, lengthCm } oppure null.
async function personalRecord(session) {
  const best = (session.catches || []).filter(c => c.species && Number(c.lengthCm) > 0)
    .sort((a, b) => b.lengthCm - a.lengthCm)[0]
  if (!best || !session.userId) return null
  const better = await Session.aggregate([
    { $match: { userId: session.userId, hidden: { $ne: true }, _id: { $ne: session._id } } },
    { $unwind: '$catches' },
    { $match: { 'catches.species': best.species, 'catches.lengthCm': { $gte: best.lengthCm } } },
    { $match: { $or: [{ 'catches.lengthCm': { $gt: best.lengthCm } }, { date: { $lt: session.date } }] } },
    { $limit: 1 }
  ])
  return better.length ? null : { species: best.species, lengthCm: best.lengthCm }
}

// Inizio del periodo in fuso Europe/Rome (settimana da lunedì, mese e anno
// di calendario): una classifica "Settimana" riparte il lunedì, non scorre.
function periodStart(period, now = new Date()) {
  if (period === 'all') return null
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Rome', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23'
  }).formatToParts(now).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]))
  const romeAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  const offset = Math.round((romeAsUtc - now.getTime()) / 60000) * 60000
  let y = parts.year, m = parts.month - 1, d = parts.day
  if (period === 'week') d -= (new Date(Date.UTC(y, m, d)).getUTCDay() + 6) % 7
  else if (period === 'month') d = 1
  else if (period === 'year') { m = 0; d = 1 }
  return new Date(Date.UTC(y, m, d) - offset)
}

export default async function sessionRoutes(app) {

  const auth = { preHandler: [app.authenticate] }

  // GET /api/sessions/bait-suggestions — esche già usate (storico) + catalogo,
  // per popolare la select-che-è-anche-input (<datalist>) del form.
  app.get('/bait-suggestions', auth, async (req) => {
    const filter = await visibilityFilter(req.user)
    const agg = await Session.aggregate([
      { $match: filter },
      { $unwind: '$catches' },
      { $project: { bait: { $trim: { input: '$catches.baitUsed' } } } },
      { $match: { bait: { $nin: [null, ''] } } },
      // group case-insensitive: "Arenicola" e "arenicola" sono la stessa esca
      { $group: { _id: { $toLower: '$bait' }, count: { $sum: 1 }, sample: { $first: '$bait' } } },
      { $sort: { count: -1 } },
      { $limit: 20 }
    ])

    const fromHistory = agg.map(a => a.sample)
    const seen = new Set(fromHistory.map(b => b.toLowerCase()))
    const catalogNames = BAIT_CATALOG.map(b => b.name).filter(b => !seen.has(b.toLowerCase()))
    return { data: [...fromHistory, ...catalogNames] }
  })

  // GET /api/sessions/bait-catalog — nome + tipo, per auto-compilare "Tipo esca"
  // quando l'utente sceglie (o scrive) un'esca standard del catalogo.
  app.get('/bait-catalog', auth, async () => ({ data: BAIT_CATALOG }))

  // GET /api/sessions
  app.get('/', auth, async (req) => {
    const { page = 1, limit = 20, technique, location, dateFrom, dateTo, search, mine, userId } = req.query
    const filter = await visibilityFilter(req.user)
    // mine=true: solo le uscite dell'utente (es. mappamondo della Home)
    if (mine === 'true') filter.userId = req.user.sub

    // Solo le uscite di un utente (per altri: solo quelle che il visitatore può già vedere)
    if (userId && mongoose.isValidObjectId(userId)) filter.userId = new mongoose.Types.ObjectId(userId)
    if (technique) filter.technique = technique
    if (location)  filter['location.name'] = new RegExp(escapeRegExp(location), 'i')
    if (dateFrom || dateTo) {
      filter.date = {}
      if (dateFrom) filter.date.$gte = new Date(dateFrom)
      if (dateTo)   filter.date.$lte = new Date(dateTo)
    }
    if (search) {
      const re = new RegExp(escapeRegExp(search), 'i')
      // $and: filter.$or contiene già il perimetro di visibilità (proprie,
      // condivise, di gruppo) e riassegnarlo farebbe trovare anche le uscite
      // private altrui.
      filter.$and = [{ $or: [
        { title: re },
        { notes: re },
        { 'location.name': re },
        { 'location.spot': re }
      ] }]
    }

    const skip = (parseInt(page) - 1) * parseInt(limit)
    const [sessions, total] = await Promise.all([
      Session.find(filter).sort({ date: -1, startTime: -1, createdAt: -1 }).skip(skip).limit(parseInt(limit)).lean(),
      Session.countDocuments(filter)
    ])

    const baseUrl = `${req.protocol}://${req.headers.host}`
    const data = sessions.map(s => ({
      ...s,
      thumbnail: s.media?.[0] ? `${baseUrl}/uploads/${s.media[0].filename}` : null
    }))

    return { data, pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) } }
  })

  // GET /api/sessions/ongoing — la pescata in corso dell'utente (al più una), se c'è
  app.get('/ongoing', auth, async (req) => {
    const session = await Session.findOne({ userId: req.user.sub, status: 'ongoing' }).lean()
    return { data: session || null }
  })

  // GET /api/sessions/stats
  app.get('/stats', auth, async (req) => {
    // Statistiche personali: solo le uscite dell'utente, non quelle altrui
    // visibili nella community.
    const filter = { userId: new mongoose.Types.ObjectId(req.user.sub) }
    const stats = await Session.aggregate([
      { $match: filter },
      { $group: { _id: null, totalSessions: { $sum: 1 }, totalCatches: { $sum: '$totalCatches' }, avgRating: { $avg: '$rating' } } }
    ])
    const base = stats[0] || { totalSessions: 0, totalCatches: 0 }

    // Catture per mese negli ultimi 12 mesi (mese corrente incluso) e specie più catturate
    const from = new Date()
    from.setDate(1); from.setHours(0, 0, 0, 0)
    from.setMonth(from.getMonth() - 11)
    const [monthly, topSpecies] = await Promise.all([
      Session.aggregate([
        { $match: { ...filter, date: { $gte: from } } },
        { $group: { _id: { y: { $year: '$date' }, m: { $month: '$date' } }, catches: { $sum: '$totalCatches' } } }
      ]),
      Session.aggregate([
        { $match: filter },
        { $unwind: '$catches' },
        { $group: { _id: '$catches.species', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 }
      ])
    ])
    const byKey = new Map(monthly.map(r => [`${r._id.y}-${r._id.m}`, r.catches]))
    const catchesByMonth = []
    for (let i = 0; i < 12; i++) {
      const d = new Date(from.getFullYear(), from.getMonth() + i, 1)
      catchesByMonth.push({ year: d.getFullYear(), month: d.getMonth() + 1, catches: byKey.get(`${d.getFullYear()}-${d.getMonth() + 1}`) || 0 })
    }
    return { ...base, catchesByMonth, topSpecies: topSpecies.map(r => ({ species: r._id, count: r.count })) }
  })

  // GET /api/sessions/leaderboard?period=week|month|all — classifica su
  // contenuto pubblico (visibility 'users', mai private o di gruppo),
  // formula semplice e dichiarata al client così com'è: +10 a uscita
  // pubblicata, +3 a cattura registrata, +5 se l'uscita ha foto/video.
  // Conta solo cosa è già visibile a tutti: niente da "barare" pubblicando
  // più spesso a vuoto, perché serve comunque contenuto vero.
  app.get('/leaderboard', auth, async (req) => {
    const { period = 'all' } = req.query
    const match = { visibility: 'users', hidden: false, userId: { $ne: null } }
    if (period === 'week' || period === 'month') match.date = { $gte: periodStart(period) }

    const rows = await Session.aggregate([
      { $match: match },
      { $addFields: {
          catchesInSession: { $size: { $ifNull: ['$catches', []] } },
          // Foto/video dell'uscita o di una sua cattura (come in /rankings).
          hasMedia: { $gt: [{ $add: [
            { $size: { $ifNull: ['$media', []] } },
            { $reduce: { input: { $ifNull: ['$catches', []] }, initialValue: 0,
                in: { $add: ['$$value', { $size: { $ifNull: ['$$this.media', []] } }] } } }
          ] }, 0] }
        }
      },
      { $group: {
          _id: '$userId',
          sessionsCount: { $sum: 1 },
          catchesCount: { $sum: '$catchesInSession' },
          mediaSessions: { $sum: { $cond: ['$hasMedia', 1, 0] } }
        }
      },
      { $addFields: {
          score: { $add: [
            { $multiply: ['$sessionsCount', 10] },
            { $multiply: ['$catchesCount', 3] },
            { $multiply: ['$mediaSessions', 5] }
          ] }
        }
      },
      { $sort: { score: -1, catchesCount: -1, _id: 1 } },
      { $limit: 50 },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
      { $unwind: '$user' },
      { $project: {
          _id: 0, userId: '$_id', score: 1, sessionsCount: 1, catchesCount: 1,
          displayName: '$user.displayName', username: '$user.username', avatar: '$user.avatar'
        }
      }
    ])

    return { data: rows, period }
  })

  // GET /api/sessions/rankings — classifiche per tipo, specie, zona e periodo.
  //   type:   longest | heaviest | fight_longest | fight_shortest | hours
  //   species (facoltativa; per le classifiche sulle catture), period: week|month|year|all
  //   scope:  world (default) | country | region | province | municipality, con `place`
  // Conta solo contenuto pubblico (visibility 'users', non nascosto). Per le
  // classifiche sulle catture, una riga per utente con il suo risultato
  // migliore; a pari valore vince chi l'ha ottenuto prima. `me` è la posizione
  // dell'utente anche se fuori dai primi 50. Le misure sono dichiarate
  // dall'utente: `hasMedia` indica se la cattura ha foto/video a supporto.
  const RANK_TYPES = {
    longest:        { field: 'lengthCm',     dir: -1, unit: 'cm' },
    heaviest:       { field: 'weightKg',     dir: -1, unit: 'kg' },
    fight_longest:  { field: 'fightMinutes', dir: -1, unit: 'min' },
    fight_shortest: { field: 'fightMinutes', dir: 1,  unit: 'min' }
  }
  const SCOPE_FIELDS = { country: 'location.country', region: 'location.region', province: 'location.province', municipality: 'location.municipality' }
  const PERIODS = ['week', 'month', 'year']

  app.get('/rankings', auth, async (req, reply) => {
    const { type = 'longest', species, scope = 'world', place, period = 'all' } = req.query
    const isHours = type === 'hours'
    if (!isHours && !RANK_TYPES[type]) return reply.status(400).send({ error: 'Tipo di classifica non valido' })
    if (scope !== 'world' && !SCOPE_FIELDS[scope]) return reply.status(400).send({ error: 'Ambito non valido' })
    if (scope !== 'world' && !place) return reply.status(400).send({ error: 'Indica la zona (place)' })
    if (period !== 'all' && !PERIODS.includes(period)) return reply.status(400).send({ error: 'Periodo non valido' })

    const match = { visibility: 'users', hidden: false, userId: { $ne: null } }
    if (period !== 'all') match.date = { $gte: periodStart(period) }
    if (scope !== 'world') match[SCOPE_FIELDS[scope]] = new RegExp(`^${escapeRegExp(String(place).trim())}$`, 'i')

    let rows
    if (isHours) {
      const toMin = f => ({ $convert: { input: { $add: [
        { $multiply: [{ $toInt: { $substrBytes: [f, 0, 2] } }, 60] },
        { $toInt: { $substrBytes: [f, 3, 2] } }
      ] }, to: 'int', onError: null, onNull: null } })
      rows = await Session.aggregate([
        { $match: { ...match, startTime: { $regex: /^\d\d:\d\d$/ }, endTime: { $regex: /^\d\d:\d\d$/ } } },
        { $addFields: { s: toMin('$startTime'), e: toMin('$endTime') } },
        { $match: { s: { $ne: null }, e: { $ne: null } } },
        // Oltre la mezzanotte: fine < inizio, si somma un giorno.
        { $addFields: { minutes: { $cond: [{ $gte: ['$e', '$s'] }, { $subtract: ['$e', '$s'] }, { $add: [{ $subtract: ['$e', '$s'] }, 1440] }] } } },
        { $group: { _id: '$userId', minutes: { $sum: '$minutes' }, sessionsCount: { $sum: 1 } } },
        { $addFields: { value: { $round: [{ $divide: ['$minutes', 60] }, 1] } } },
        { $sort: { minutes: -1, _id: 1 } },
        { $project: { _id: 0, userId: '$_id', value: 1, sessionsCount: 1 } }
      ])
    } else {
      const { field, dir } = RANK_TYPES[type]
      const catchMatch = { [`catches.${field}`]: { $gt: 0 } }
      if (species) catchMatch['catches.species'] = new RegExp(`^${escapeRegExp(String(species).trim())}$`, 'i')
      rows = await Session.aggregate([
        { $match: match },
        { $unwind: '$catches' },
        { $match: catchMatch },
        { $project: {
            userId: 1, date: 1, sessionId: '$_id', species: '$catches.species', value: `$catches.${field}`,
            released: '$catches.released', location: '$location.name',
            hasMedia: { $gt: [{ $add: [{ $size: { $ifNull: ['$catches.media', []] } }, { $size: { $ifNull: ['$media', []] } }] }, 0] }
        } },
        { $sort: { value: dir, date: 1, sessionId: 1 } },
        { $group: { _id: '$userId', best: { $first: '$$ROOT' } } },
        { $replaceRoot: { newRoot: { $mergeObjects: ['$best', { userId: '$_id' }] } } },
        { $sort: { value: dir, date: 1, sessionId: 1 } },
        { $project: { _id: 0 } }
      ])
    }

    const meIdx = rows.findIndex(r => String(r.userId) === String(req.user.sub))
    const top = rows.slice(0, 50)
    const ids = [...new Set([...top.map(r => String(r.userId)), ...(meIdx >= 50 ? [String(rows[meIdx].userId)] : [])])]
    const users = await User.find({ _id: { $in: ids } }).select('displayName username avatar').lean()
    const byId = new Map(users.map(u => [String(u._id), u]))
    const decorate = (r, i) => ({ ...r, position: i + 1, displayName: byId.get(String(r.userId))?.displayName, username: byId.get(String(r.userId))?.username, avatar: byId.get(String(r.userId))?.avatar })
    const data = top.map(decorate).filter(r => r.displayName)
    const me = meIdx >= 0 ? decorate(rows[meIdx], meIdx) : null

    return { data, me, total: rows.length, type, species: species || null, scope, place: place || null, period, unit: isHours ? 'h' : RANK_TYPES[type].unit }
  })

  // GET /api/sessions/:id
  app.get('/:id', auth, async (req, reply) => {
    const filter = await visibilityFilter(req.user)
    const session = await Session.findOne({ _id: req.params.id, ...filter }).lean()
    if (!session) return reply.status(404).send({ error: 'Sessione non trovata o non accessibile' })

    const baseUrl = `${req.protocol}://${req.headers.host}`
    session.media = session.media?.map(m => ({ ...m, url: `${baseUrl}/uploads/${m.filename}` }))
    session.record = await personalRecord(session)
    return session
  })

  // POST /api/sessions — al più una sessione "ongoing" per utente: se ce n'è
  // già una in corso, il tentativo di aprirne un'altra viene rifiutato
  // (mai una chiusura silenziosa che sostituisce dati non ancora salvati).
  app.post('/', auth, async (req, reply) => {
    const existingOngoing = await Session.findOne({ userId: req.user.sub, status: 'ongoing' }).lean()
    if (existingOngoing) {
      return reply.status(409).send({ error: 'Hai già un\'uscita in corso', ongoingId: existingOngoing._id })
    }
    // Come in PATCH: `hidden` è un campo di sola moderazione, non va accettato dal body dell'utente.
    const { hidden, ...body } = req.body
    const session = new Session({ ...body, userId: req.user.sub, status: 'ongoing' })
    await session.save()
    return reply.status(201).send(session)
  })

  // PATCH /api/sessions/:id
  app.patch('/:id', auth, async (req, reply) => {
    const session = await Session.findById(req.params.id)
    if (!session) return reply.status(404).send({ error: 'Sessione non trovata' })
    if (!canEdit(req.user, session)) return reply.status(403).send({ error: 'Permesso negato' })

    // Impedisce di modificare campi riservati
    const { userId, hidden, ...body } = req.body

    // Anche riaprendo una sessione via PATCH non deve poterne coesistere
    // più di una "ongoing" per utente.
    if (body.status === 'ongoing' && session.status !== 'ongoing') {
      const otherOngoing = await Session.findOne({ userId: req.user.sub, status: 'ongoing', _id: { $ne: session._id } }).lean()
      if (otherOngoing) return reply.status(409).send({ error: 'Hai già un\'uscita in corso', ongoingId: otherOngoing._id })
    }

    Object.assign(session, body)
    await session.save()
    return session
  })

  // DELETE /api/sessions/:id
  app.delete('/:id', auth, async (req, reply) => {
    const session = await Session.findById(req.params.id)
    if (!session) return reply.status(404).send({ error: 'Sessione non trovata' })
    if (!canEdit(req.user, session)) return reply.status(403).send({ error: 'Permesso negato' })

    await session.deleteOne()
    return { deleted: true, id: req.params.id }
  })

  // PATCH /api/sessions/:id/hide — moderator/admin
  app.patch('/:id/hide', auth, async (req, reply) => {
    if (!canModerate(req.user)) return reply.status(403).send({ error: 'Permesso negato' })
    const session = await Session.findByIdAndUpdate(req.params.id, { hidden: req.body.hidden ?? true }, { new: true })
    if (!session) return reply.status(404).send({ error: 'Sessione non trovata' })
    return { hidden: session.hidden }
  })
}