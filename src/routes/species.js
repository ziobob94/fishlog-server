import Species from '../models/Species.js'
import SpeciesReport from '../models/SpeciesReport.js'
import Session from '../models/Session.js'
import { searchGbif, fetchGbifDetail } from '../utils/gbif.js'
import { searchINaturalistFish } from '../utils/inaturalist.js'
import { escapeRegExp } from '../utils/regex.js'

export default async function speciesRoutes(app) {

  const auth = { preHandler: [app.authenticate] }

  // GET /api/species/search?q=  — ricerca globale (cache locale + arricchimento on-demand)
  app.get('/search', auth, async (req) => {
    const q = (req.query.q || '').trim()
    if (q.length < 2) return { data: [] }

    // \b ancora la ricerca all'inizio di una parola: senza, "orata" farebbe
    // match anche su "marmorata", "irrorata" e altri falsi positivi.
    const wordMatch = new RegExp('\\b' + escapeRegExp(q), 'i')
    let results = await Species.find({
      $or: [
        { commonNameIt: wordMatch },
        { commonNameEn: wordMatch },
        { scientificName: wordMatch }
      ]
    }).limit(10).lean()

    if (results.length < 5) {
      // iNaturalist indicizza bene i nomi comuni (anche italiani), a differenza
      // di GBIF che copre quasi solo nomi scientifici: risolve sia il caso
      // "cerco un nome comune non ancora in cache" sia "il record importato
      // in blocco da GBIF non aveva un nome comune valorizzato".
      const known = new Set(results.map(r => r._id.toString()))
      const inat = await searchINaturalistFish(q)

      for (const r of inat) {
        const existing = await Species.findOne({ scientificName: r.scientificName })
        if (existing) {
          const patch = {}
          if (!existing.commonNameIt && r.commonNameIt) patch.commonNameIt = r.commonNameIt
          if (!existing.commonNameEn && r.commonNameEn) patch.commonNameEn = r.commonNameEn
          if (!existing.imageUrl && r.imageUrl) patch.imageUrl = r.imageUrl
          if (Object.keys(patch).length) {
            await Species.updateOne({ _id: existing._id }, { $set: patch })
            Object.assign(existing, patch)
          }
          if (!known.has(existing._id.toString())) {
            known.add(existing._id.toString())
            results.push(existing)
          }
        } else {
          const created = await Species.create({ ...r, source: 'inaturalist' })
          known.add(created._id.toString())
          results.push(created.toObject())
        }
      }

      // Se la query è comunque un nome scientifico (genere/specie in latino),
      // GBIF resta utile per trovarlo anche quando iNaturalist non lo indicizza.
      if (results.length < 5) {
        const gbifMatches = await searchGbif(q)
        const knownGbifKeys = new Set(results.map(r => r.gbifKey).filter(Boolean))
        const toInsert = gbifMatches.filter(r => !knownGbifKeys.has(r.gbifKey))
        if (toInsert.length) {
          await Species.bulkWrite(toInsert.map(r => ({
            updateOne: { filter: { gbifKey: r.gbifKey }, update: { $setOnInsert: r }, upsert: true }
          })))
        }
        results = [...results, ...toInsert]
      }

      results = results.slice(0, 10)
    }

    return { data: results }
  })

  // GET /api/species/suggestions?lat=&lng=&region=&radiusKm=
  // Specie più pescate nella zona, basate sullo storico sessioni; se non
  // c'è ancora storico (o la posizione non è stata inserita) restituisce
  // un fallback con le specie più comuni a livello globale.
  app.get('/suggestions', auth, async (req) => {
    const { lat, lng, region, radiusKm = 50 } = req.query
    const match = {}

    if (lat && lng) {
      const latNum = parseFloat(lat)
      const lngNum = parseFloat(lng)
      const dLat = radiusKm / 111
      const dLng = radiusKm / (111 * Math.cos(latNum * Math.PI / 180) || 1)
      match['location.coords.lat'] = { $gte: latNum - dLat, $lte: latNum + dLat }
      match['location.coords.lng'] = { $gte: lngNum - dLng, $lte: lngNum + dLng }
    } else if (region) {
      match['location.region'] = new RegExp(escapeRegExp(region), 'i')
    }

    let data = []
    if (Object.keys(match).length) {
      const agg = await Session.aggregate([
        { $match: match },
        { $unwind: '$catches' },
        { $group: { _id: '$catches.species', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 8 }
      ])
      data = agg.map(a => ({ species: a._id, count: a.count }))
    }

    if (!data.length) {
      const popular = await Species.find({ popular: true }).limit(8).lean()
      data = popular.map(p => ({ species: p.commonNameIt || p.commonNameEn || p.scientificName, count: null }))
    }

    return { data }
  })

  // GET /api/species/name/:name — scheda specie pubblica: dati del catalogo
  // più calendario mensile ed esche/tecniche più usate, calcolati dalle
  // catture reali della community (non da stime editoriali). Si cerca per
  // nome e non per _id perché catches.species è testo libero (quello
  // scritto o scelto durante il log di una cattura), senza riferimento
  // diretto al documento Species.
  app.get('/name/:name', auth, async (req, reply) => {
    const name = (req.params.name || '').trim()
    if (!name) return reply.status(400).send({ error: 'Nome specie mancante' })

    const exact = new RegExp('^' + escapeRegExp(name) + '$', 'i')
    const sp = await Species.findOne({
      $or: [{ commonNameIt: exact }, { commonNameEn: exact }, { scientificName: exact }]
    }).lean()

    if (!sp) return reply.status(404).send({ error: 'Specie non trovata nel catalogo' })

    // Le catture sono testo libero: il match usa tutti i nomi noti della
    // specie (non solo quello passato in query), altrimenti una cattura
    // loggata con "Spigola" non si aggancerebbe a una ricerca per "Branzino".
    const knownNames = [sp.commonNameIt, sp.commonNameEn, sp.scientificName].filter(Boolean)
    const nameMatch = { $in: knownNames.map(n => new RegExp('^' + escapeRegExp(n) + '$', 'i')) }

    const [calendar, gear] = await Promise.all([
      Session.aggregate([
        { $unwind: '$catches' },
        { $match: { 'catches.species': nameMatch } },
        { $group: { _id: { $month: '$date' }, count: { $sum: 1 } } }
      ]),
      Session.aggregate([
        { $unwind: '$catches' },
        { $match: { 'catches.species': nameMatch } },
        { $group: { _id: { bait: '$catches.baitUsed', technique: '$technique' }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 8 }
      ])
    ])

    const monthlyCatches = Array(12).fill(0)
    for (const m of calendar) monthlyCatches[m._id - 1] = m.count

    return {
      ...sp,
      monthlyCatches,
      topBaits: [...new Set(gear.map(g => g._id.bait).filter(Boolean))].slice(0, 6),
      topTechniques: [...new Set(gear.map(g => g._id.technique).filter(Boolean))].slice(0, 6),
      catchCount: monthlyCatches.reduce((a, b) => a + b, 0)
    }
  })

  // GET /api/species/:key/detail — descrizione + immagine, arricchite on-demand da GBIF
  app.get('/:key/detail', auth, async (req, reply) => {
    const gbifKey = parseInt(req.params.key, 10)
    if (Number.isNaN(gbifKey)) return reply.status(400).send({ error: 'key non valida' })

    const sp = await Species.findOne({ gbifKey })
    if (!sp) return reply.status(404).send({ error: 'Specie non trovata' })

    if (!sp.description || !sp.imageUrl) {
      const detail = await fetchGbifDetail(gbifKey)
      if (detail.description) sp.description = detail.description
      if (detail.imageUrl) sp.imageUrl = detail.imageUrl
      await sp.save()
    }

    return sp
  })

  // POST /api/species/report — l'utente segnala un pesce non trovato nel catalogo
  app.post('/report', auth, async (req, reply) => {
    const { query, note } = req.body || {}
    if (!query) return reply.status(400).send({ error: 'query richiesta' })

    const report = await SpeciesReport.create({ query, note, userId: req.user.sub })
    return reply.status(201).send(report)
  })
}
