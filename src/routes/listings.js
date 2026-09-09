import mongoose from 'mongoose'
import Listing, { CATEGORIES } from '../models/Listing.js'
import Session from '../models/Session.js'
import User from '../models/User.js'
import { canEdit } from '../utils/listingAccess.js'
import { searchEbay } from '../utils/ebay.js'
import { escapeRegExp } from '../utils/regex.js'

// Tecnica di pesca più praticata → attrezzatura pertinente da cercare su
// eBay quando l'utente non ha impostato una ricerca propria.
const TECHNIQUE_QUERY = {
  spinning:    'canna da spinning pesca',
  surfcasting: 'canna da surfcasting pesca',
  feeder:      'canna da feeder pesca',
  bolentino:   'canna da bolentino pesca',
  mosca:       'canna da pesca a mosca'
}

// Categoria di interesse dichiarata → termine di ricerca eBay.
const CATEGORY_QUERY = {
  canne:         'canna da pesca',
  mulinelli:     'mulinello da pesca',
  esche:         'esche da pesca',
  ami_terminali: 'ami da pesca',
  abbigliamento: 'abbigliamento da pesca',
  accessori:     'accessori da pesca',
  imbarcazioni:  'imbarcazione da pesca'
}

export default async function listingRoutes(app) {

  const auth = { preHandler: [app.authenticate] }

  // Ricerca eBay "personalizzata": priorità alle preferenze dichiarate
  // dall'utente (sondaggio post-registrazione o profilo); in assenza di
  // preferenze esplicite, deduce la tecnica più usata dalle sue sessioni di
  // pesca. Senza storico (o utente anonimo) restituisce null e si ricade sul
  // default generico di searchEbay ("attrezzatura da pesca").
  async function personalizedQuery(userId) {
    if (!userId) return null

    const user = await User.findById(userId).select('marketPreferences').lean()
    const prefs = user?.marketPreferences

    if (prefs?.categories?.length) return CATEGORY_QUERY[prefs.categories[0]] || null
    if (prefs?.technique) return TECHNIQUE_QUERY[prefs.technique] || null

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
    if (location)   filter['location.name'] = new RegExp(escapeRegExp(location), 'i')
    if (priceMin || priceMax) {
      filter.price = {}
      if (priceMin) filter.price.$gte = Number(priceMin)
      if (priceMax) filter.price.$lte = Number(priceMax)
    }
    if (search) {
      const re = new RegExp(escapeRegExp(search), 'i')
      filter.$or = [
        { title: re },
        { description: re }
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
      // Risposta 200 anche in caso di errore: lato client sembra "nessun
      // risultato" per non allarmare l'utente. Il dettaglio dell'errore va
      // solo agli admin (loggati con token valido), per non esporre a tutti
      // dettagli interni (status/messaggio dell'API eBay).
      const isAdmin = req.user?.role === 'admin'
      return {
        configured: true,
        data: [],
        error: isAdmin ? (err.message || 'Ricerca esterna non disponibile') : undefined
      }
    }
  })

  // GET /api/listings/mine — annunci dell'utente loggato (inclusi non attivi)
  app.get('/mine', auth, async (req) => {
    const baseUrl = `${req.protocol}://${req.headers.host}`
    const listings = await Listing.find({ seller: req.user.sub, status: { $ne: 'deleted' } })
      .sort({ createdAt: -1 }).populate('seller', 'displayName avatar shop').lean()
    return { data: listings.map(l => withMediaUrls(baseUrl, l)) }
  })

  // GET /api/listings/shops — elenco pubblico dei negozi verificati (tab
  // "Negozi" del market). Solo verified: quelli in attesa/rifiutati restano
  // raggiungibili solo dal link diretto della propria vetrina, non da qui.
  app.get('/shops', async (req) => {
    const { page = 1, limit = 20, search } = req.query

    const filter = { 'shop.enabled': true, 'shop.verificationStatus': 'verified' }
    if (search) {
      const re = new RegExp(escapeRegExp(search), 'i')
      filter.$or = [{ 'shop.name': re }, { displayName: re }]
    }

    const skip = (Number(page) - 1) * Number(limit)
    const [shops, total] = await Promise.all([
      User.find(filter).select('displayName avatar shop')
        .sort({ 'shop.verifiedAt': -1 }).skip(skip).limit(Number(limit)).lean(),
      User.countDocuments(filter)
    ])

    const counts = await Listing.aggregate([
      { $match: { seller: { $in: shops.map(s => s._id) }, status: 'active' } },
      { $group: { _id: '$seller', count: { $sum: 1 } } }
    ])
    const countBySeller = Object.fromEntries(counts.map(c => [c._id.toString(), c.count]))

    return {
      data: shops.map(s => ({
        _id: s._id,
        displayName: s.displayName,
        avatar: s.avatar,
        shop: { name: s.shop.name, description: s.shop.description },
        activeListings: countBySeller[s._id.toString()] || 0
      })),
      pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / limit) }
    }
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
