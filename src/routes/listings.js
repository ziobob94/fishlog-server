import mongoose from 'mongoose'
import Listing, { CATEGORIES } from '../models/Listing.js'
import Session from '../models/Session.js'
import User from '../models/User.js'
import ListingView from '../models/ListingView.js'
import { canEdit, listingVisibilityFilter, parseVisibility } from '../utils/listingAccess.js'
import { searchEbay } from '../utils/ebay.js'
import { escapeRegExp } from '../utils/regex.js'

// Dati del negozio visibili a tutti: P.IVA, telefono, documento e motivo del
// rifiuto restano privati.
const PUBLIC_SELLER_SELECT = 'displayName avatar shop.enabled shop.name shop.description shop.verificationStatus shop.verifiedAt shop.sellerType shop.website shop.city shop.delivery shop.contact shop.logo'

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

  // Auth opzionale: id dell'utente se c'è un token valido, altrimenti null (anonimo).
  async function optionalViewer(req) {
    try { await req.jwtVerify(); return req.user.sub } catch { return null }
  }

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

  // GET /api/listings — ricerca pubblica con filtri, tab "Annunci" del
  // market: solo venditori privati. Gli annunci di un negozio si sfogliano
  // dalla sua vetrina (/listings/shop/:userId, tab "Negozi"), non qui, per
  // non duplicarli in due sezioni diverse.
  app.get('/', async (req) => {
    const {
      page = 1, limit = 20, search, category, condition,
      location, priceMin, priceMax
    } = req.query

    const viewerId = await optionalViewer(req)
    const filter = { status: 'active', sellerType: 'privato', $and: [await listingVisibilityFilter(viewerId)] }

    if (category)   filter.category = category
    if (condition)  filter.condition = condition
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
        .populate('seller', PUBLIC_SELLER_SELECT)
        .lean(),
      Listing.countDocuments(filter)
    ])

    const baseUrl = `${req.protocol}://${req.headers.host}`
    return {
      data: listings.map(l => withMediaUrls(baseUrl, l)),
      pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / limit) }
    }
  })

  // GET /api/listings/external — tab "eBay & altre piattaforme" del market:
  // annunci dal marketplace IT di eBay (in futuro altre fonti esterne, da qui
  // il nome generico). "configured:false" se l'app eBay Developer non è
  // ancora stata registrata in config/local.json.
  app.get('/external', async (req, reply) => {
    const { search, zip, limit, page, category, condition, priceMin, priceMax } = req.query

    // Auth opzionale: se c'è un token valido personalizziamo la query di
    // default, ma la ricerca esterna resta disponibile anche da anonimo.
    let userId = null
    try {
      await req.jwtVerify()
      userId = req.user.sub
    } catch { /* nessun blocco: procede come ricerca anonima */ }

    try {
      // Stessa priorità della ricerca interna: testo libero prima, poi la
      // categoria selezionata (tradotta nel termine eBay corrispondente),
      // solo in assenza di entrambe si ricade sulla query personalizzata.
      const query = search || (category && CATEGORY_QUERY[category]) || (userId ? await personalizedQuery(userId) : null)
      const lim = limit ? Number(limit) : 12
      const offset = page ? (Number(page) - 1) * lim : 0
      const result = await searchEbay({
        query, zip, limit: lim, offset, condition,
        priceMin: priceMin ? Number(priceMin) : undefined,
        priceMax: priceMax ? Number(priceMax) : undefined
      })
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
      .sort({ createdAt: -1 }).populate('seller', PUBLIC_SELLER_SELECT).lean()
    return { data: listings.map(l => withMediaUrls(baseUrl, l)) }
  })

  // GET /api/listings/shops — elenco pubblico dei negozi verificati (tab
  // "Negozi" del market). Solo verified: quelli in attesa/rifiutati restano
  // raggiungibili solo dal link diretto della propria vetrina, non da qui.
  app.get('/shops', async (req) => {
    const { page = 1, limit = 20, search } = req.query

    const filter = { 'shop.enabled': true, 'shop.verificationStatus': 'verified', 'shop.sellerType': { $ne: 'privato' } }
    if (search) {
      const re = new RegExp(escapeRegExp(search), 'i')
      filter.$or = [{ 'shop.name': re }, { displayName: re }]
    }

    const skip = (Number(page) - 1) * Number(limit)
    const [shops, total] = await Promise.all([
      User.find(filter).select(PUBLIC_SELLER_SELECT)
        .sort({ 'shop.verifiedAt': -1 }).skip(skip).limit(Number(limit)).lean(),
      User.countDocuments(filter)
    ])

    const counts = await Listing.aggregate([
      { $match: { seller: { $in: shops.map(s => s._id) }, status: 'active', visibility: { $in: ['all', null] } } },
      { $group: { _id: '$seller', count: { $sum: 1 } } }
    ])
    const countBySeller = Object.fromEntries(counts.map(c => [c._id.toString(), c.count]))

    return {
      data: shops.map(s => ({
        _id: s._id,
        displayName: s.displayName,
        avatar: s.avatar,
        shop: { name: s.shop.name, description: s.shop.description, logo: s.shop.logo },
        activeListings: countBySeller[s._id.toString()] || 0
      })),
      pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / limit) }
    }
  })

  // GET /api/listings/shop/:userId — vetrina pubblica di un negozio
  app.get('/shop/:userId', async (req, reply) => {
    const user = await User.findById(req.params.userId).select(PUBLIC_SELLER_SELECT).lean()
    if (!user?.shop?.enabled) return reply.status(404).send({ error: 'Negozio non trovato' })

    const baseUrl = `${req.protocol}://${req.headers.host}`
    const viewerId = await optionalViewer(req)
    const listings = await Listing.find({ seller: user._id, status: 'active', $and: [await listingVisibilityFilter(viewerId)] }).sort({ createdAt: -1 }).lean()
    return { shop: { _id: user._id, displayName: user.displayName, avatar: user.avatar, ...user.shop }, listings: listings.map(l => withMediaUrls(baseUrl, l)) }
  })

  // GET /api/listings/:id
  app.get('/:id', async (req, reply) => {
    const listing = await Listing.findById(req.params.id).populate('seller', PUBLIC_SELLER_SELECT + ' email').lean()
    if (!listing || listing.status === 'deleted') return reply.status(404).send({ error: 'Annuncio non trovato' })
    // Visibilità: un annuncio non visibile a chi guarda si comporta come inesistente.
    const viewerId = await optionalViewer(req)
    const isSeller = !!viewerId && listing.seller?._id?.toString() === viewerId
    const vis = listing.visibility || 'all'
    if (vis !== 'all' && !isSeller) {
      const visible = viewerId && await Listing.exists({ _id: listing._id, $and: [await listingVisibilityFilter(viewerId)] })
      if (!visible) return reply.status(404).send({ error: 'Annuncio non trovato' })
    }
    const baseUrl = `${req.protocol}://${req.headers.host}`
    return withMediaUrls(baseUrl, listing)
  })

  // POST /api/listings/:id/view — registra una visualizzazione unica: una per
  // utente e per annuncio, mai quella del venditore. Riaperture e richieste in
  // parallelo non aumentano il contatore (indice unico su ListingView).
  app.post('/:id/view', auth, async (req, reply) => {
    const listing = await Listing.findById(req.params.id).select('seller status views').lean()
    if (!listing || listing.status === 'deleted') return reply.status(404).send({ error: 'Annuncio non trovato' })
    if (listing.seller.toString() === req.user.sub) return { views: listing.views || 0, counted: false }
    let counted = false
    try {
      await ListingView.create({ listing: listing._id, user: req.user.sub })
      counted = true
    } catch (err) {
      if (err.code !== 11000) throw err   // già visto: nessun incremento
    }
    const updated = counted
      ? await Listing.findByIdAndUpdate(listing._id, { $inc: { views: 1 } }, { new: true }).select('views').lean()
      : listing
    return { views: updated?.views || 0, counted }
  })

  // POST /api/listings
  app.post('/', auth, async (req, reply) => {
    const { title, description, category, condition, price, currency, location } = req.body

    if (!title || !condition || price == null) {
      return reply.status(400).send({ error: 'Titolo, condizione e prezzo sono obbligatori' })
    }

    const user = await User.findById(req.user.sub).select('shop').lean()

    // Un negozio deve essere verificato; un privato può pubblicare subito,
    // senza P.IVA né documenti.
    const isShop = !!(user?.shop?.enabled && user.shop.sellerType !== 'privato')
    if (isShop && user.shop.verificationStatus !== 'verified') {
      return reply.status(403).send({ error: 'Per pubblicare come negozio devi prima essere verificato', code: 'SELLER_NOT_VERIFIED' })
    }

    const vis = await parseVisibility(req.user.sub, req.body)
    if (vis.error) return reply.status(400).send({ error: vis.error })

    const listing = await Listing.create({
      ...vis,
      seller: req.user.sub,
      sellerType: isShop ? 'negozio' : 'privato',
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
    const vis = await parseVisibility(listing.seller.toString(), req.body)
    if (vis.error) return reply.status(400).send({ error: vis.error })
    if (vis.visibility) { listing.visibility = vis.visibility; listing.allowedGroups = vis.allowedGroups }

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
