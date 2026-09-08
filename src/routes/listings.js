import mongoose from 'mongoose'
import Listing, { CATEGORIES } from '../models/Listing.js'
import Session from '../models/Session.js'
import User from '../models/User.js'
import { canEdit } from '../utils/listingAccess.js'
import { searchEbay } from '../utils/ebay.js'

// Tecnica di pesca più praticata → attrezzatura pertinente da cercare su
// eBay quando l'utente non ha impostato una ricerca propria.
const TECHNIQUE_QUERY = {
  spinning:    'canna da spinning pesca',
  surfcasting: 'canna da surfcasting pesca',
  feeder:      'canna da feeder pesca',
  bolentino:   'canna da bolentino pesca',
  mosca:       'canna da pesca a mosca'
}

export default async function listingRoutes(app) {

  const auth = { preHandler: [app.authenticate] }

  // Ricerca eBay "personalizzata": guarda la tecnica più usata nelle sessioni
  // di pesca dell'utente e propone l'attrezzatura corrispondente. Senza
  // storico (o utente anonimo) restituisce null e si ricade sul default
  // generico di searchEbay ("attrezzatura da pesca").
  async function personalizedQuery(userId) {
    if (!userId) return null

    const [top] = await Session.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId), technique: { $nin: [null, ''] } } },
      { $group: { _id: '$technique', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 1 }
    ])

    return (top && TECHNIQUE_QUERY[top._id]) || null
  }

  function withMediaUrls(baseUrl, listing) {
    return { ...listing, media: (listing.media || []).map(m => ({ ...m, url: `${baseUrl}/uploads/${m.filename}` })) }
  }

  // GET /api/listings/categories — per popolare il filtro categoria lato client
  app.get('/categories', async () => ({ data: CATEGORIES }))

  // GET /api/listings — ricerca pubblica con filtri
  app.get('/', async (req) => {
    const {
      page = 1, limit = 20, search, category, condition, sellerType,
      location, priceMin, priceMax
    } = req.query

    const filter = { status: 'active' }

    if (category)   filter.category = category
    if (condition)  filter.condition = condition
    if (sellerType) filter.sellerType = sellerType
    if (location)   filter['location.name'] = new RegExp(location, 'i')
    if (priceMin || priceMax) {
      filter.price = {}
      if (priceMin) filter.price.$gte = Number(priceMin)
      if (priceMax) filter.price.$lte = Number(priceMax)
    }
    if (search) {
      filter.$or = [
        { title: new RegExp(search, 'i') },
        { description: new RegExp(search, 'i') }
      ]
    }

    const skip = (Number(page) - 1) * Number(limit)
    const [listings, total] = await Promise.all([
      Listing.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .populate('seller', 'displayName avatar shop')
        .lean(),
      Listing.countDocuments(filter)
    ])

    const baseUrl = `${req.protocol}://${req.headers.host}`
    return {
      data: listings.map(l => withMediaUrls(baseUrl, l)),
      pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / limit) }
    }
  })

  // GET /api/listings/external — fallback quando il market interno è vuoto/scarso:
  // annunci simili da eBay (marketplace IT). "configured:false" se l'app eBay
  // Developer non è ancora stata registrata in config/local.json.
  app.get('/external', async (req, reply) => {
    const { search, zip, limit } = req.query

    // Auth opzionale: se c'è un token valido personalizziamo la query di
    // default, ma la ricerca esterna resta disponibile anche da anonimo.
    let userId = null
    try {
      await req.jwtVerify()
      userId = req.user.sub
    } catch { /* nessun blocco: procede come ricerca anonima */ }

    try {
      const query = search || (userId ? await personalizedQuery(userId) : null)
      const result = await searchEbay({ query, zip, limit: limit ? Number(limit) : undefined })
      return result
    } catch (err) {
      req.log.error(err, 'eBay search failed')
      return reply.status(502).send({ configured: true, data: [], error: 'Ricerca esterna non disponibile' })
    }
  })

  // GET /api/listings/mine — annunci dell'utente loggato (inclusi non attivi)
  app.get('/mine', auth, async (req) => {
    const baseUrl = `${req.protocol}://${req.headers.host}`
    const listings = await Listing.find({ seller: req.user.sub, status: { $ne: 'deleted' } })
      .sort({ createdAt: -1 }).populate('seller', 'displayName avatar shop').lean()
    return { data: listings.map(l => withMediaUrls(baseUrl, l)) }
  })

  // GET /api/listings/shop/:userId — vetrina pubblica di un negozio
  app.get('/shop/:userId', async (req, reply) => {
    const user = await User.findById(req.params.userId).select('displayName avatar shop').lean()
    if (!user?.shop?.enabled) return reply.status(404).send({ error: 'Negozio non trovato' })

    const baseUrl = `${req.protocol}://${req.headers.host}`
    const listings = await Listing.find({ seller: user._id, status: 'active' }).sort({ createdAt: -1 }).lean()
    return { shop: { _id: user._id, displayName: user.displayName, avatar: user.avatar, ...user.shop }, listings: listings.map(l => withMediaUrls(baseUrl, l)) }
  })

  // GET /api/listings/:id
  app.get('/:id', async (req, reply) => {
    const listing = await Listing.findById(req.params.id).populate('seller', 'displayName avatar shop email').lean()
    if (!listing || listing.status === 'deleted') return reply.status(404).send({ error: 'Annuncio non trovato' })
    await Listing.updateOne({ _id: listing._id }, { $inc: { views: 1 } })
    const baseUrl = `${req.protocol}://${req.headers.host}`
    return withMediaUrls(baseUrl, listing)
  })

  // POST /api/listings
  app.post('/', auth, async (req, reply) => {
    const { title, description, category, condition, price, currency, location } = req.body

    if (!title || !condition || price == null) {
      return reply.status(400).send({ error: 'Titolo, condizione e prezzo sono obbligatori' })
    }

    const user = await User.findById(req.user.sub).select('shop').lean()

    const listing = await Listing.create({
      seller: req.user.sub,
      sellerType: user?.shop?.enabled ? 'negozio' : 'privato',
      title, description, category, condition, price,
      currency: currency || 'EUR',
      location
    })

    return reply.status(201).send(listing)
  })

  // PATCH /api/listings/:id
  app.patch('/:id', auth, async (req, reply) => {
    const listing = await Listing.findById(req.params.id)
    if (!listing) return reply.status(404).send({ error: 'Annuncio non trovato' })
    if (!canEdit(req.user, listing)) return reply.status(403).send({ error: 'Permesso negato' })

    const { title, description, category, condition, price, currency, location, status } = req.body

    if (title !== undefined)       listing.title = title
    if (description !== undefined) listing.description = description
    if (category !== undefined)    listing.category = category
    if (condition !== undefined)   listing.condition = condition
    if (price !== undefined)       listing.price = price
    if (currency !== undefined)    listing.currency = currency
    if (location !== undefined)    listing.location = location
    if (status !== undefined && ['active', 'reserved', 'sold'].includes(status)) listing.status = status

    await listing.save()
    return listing
  })

  // DELETE /api/listings/:id — soft delete, coerente con lo storico ordini/chat futuri
  app.delete('/:id', auth, async (req, reply) => {
    const listing = await Listing.findById(req.params.id)
    if (!listing) return reply.status(404).send({ error: 'Annuncio non trovato' })
    if (!canEdit(req.user, listing)) return reply.status(403).send({ error: 'Permesso negato' })

    listing.status = 'deleted'
    await listing.save()
    return { deleted: true }
  })
}
