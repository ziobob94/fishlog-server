import Regulation from '../models/Regulation.js'
import Species from '../models/Species.js'
import { escapeRegExp } from '../utils/regex.js'

export default async function regulationRoutes(app) {

  const auth      = { preHandler: [app.authenticate] }
  const adminOnly = { preHandler: [app.requireRole('admin')] }

  // GET /api/regulations?species=&region= — norme applicabili, pubblica
  // (nessun login richiesto: un dato legale deve essere visibile a tutti,
  // non solo a chi ha un account). Le regole 'general' per la regione
  // chiesta vengono sempre incluse insieme a quelle della specie.
  app.get('/', async (req) => {
    const { species, region } = req.query
    const or = []

    if (species) {
      const sp = await Species.findOne({
        $or: [
          { commonNameIt: new RegExp('^' + escapeRegExp(species) + '$', 'i') },
          { commonNameEn: new RegExp('^' + escapeRegExp(species) + '$', 'i') },
          { scientificName: new RegExp('^' + escapeRegExp(species) + '$', 'i') }
        ]
      }).lean()
      const knownNames = [species, sp?.commonNameIt, sp?.commonNameEn, sp?.scientificName].filter(Boolean)
      or.push({ scope: 'species', speciesName: { $in: knownNames.map(n => new RegExp('^' + escapeRegExp(n) + '$', 'i')) } })
    }
    if (region) {
      or.push({ scope: 'general', region: new RegExp(escapeRegExp(region), 'i') })
    } else if (species) {
      // Senza regione non filtriamo le regole 'general' per non nasconderle:
      // meglio mostrarne di non pertinenti che nascondere un divieto vero.
      or.push({ scope: 'general' })
    }

    if (!or.length) return { data: [] }

    const data = await Regulation.find({ $or: or }).sort({ scope: 1, region: 1 }).lean()
    return { data }
  })

  // CRUD admin — le norme sono curate a mano, mai generate.
  app.get('/admin', adminOnly, async (req) => {
    const { search } = req.query
    const filter = search
      ? { $or: [{ speciesName: new RegExp(escapeRegExp(search), 'i') }, { region: new RegExp(escapeRegExp(search), 'i') }, { title: new RegExp(escapeRegExp(search), 'i') }] }
      : {}
    const data = await Regulation.find(filter).sort({ updatedAt: -1 }).lean()
    return { data }
  })

  app.post('/admin', adminOnly, async (req, reply) => {
    const { scope, speciesName, region, title, minSizeCm, maxCatchPerDay, closedSeason, protected: isProtected, notes, sourceTitle, sourceUrl } = req.body || {}

    if (!scope || !region || !title || !sourceTitle)
      return reply.status(400).send({ error: 'scope, region, title e sourceTitle sono obbligatori' })
    if (scope === 'species' && !speciesName)
      return reply.status(400).send({ error: 'speciesName obbligatorio per le regole di specie' })

    const regulation = await Regulation.create({
      scope, speciesName, region, title, minSizeCm, maxCatchPerDay, closedSeason,
      protected: !!isProtected, notes, sourceTitle, sourceUrl
    })
    return reply.status(201).send(regulation)
  })

  app.patch('/admin/:id', adminOnly, async (req, reply) => {
    const regulation = await Regulation.findById(req.params.id)
    if (!regulation) return reply.status(404).send({ error: 'Norma non trovata' })

    const fields = ['scope', 'speciesName', 'region', 'title', 'minSizeCm', 'maxCatchPerDay', 'closedSeason', 'protected', 'notes', 'sourceTitle', 'sourceUrl']
    for (const f of fields) if (f in req.body) regulation[f] = req.body[f]

    await regulation.save()
    return regulation
  })

  app.delete('/admin/:id', adminOnly, async (req, reply) => {
    await Regulation.findByIdAndDelete(req.params.id)
    return { deleted: true }
  })
}
