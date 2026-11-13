import { createHash } from 'node:crypto'
import FipsasProva from '../models/FipsasProva.js'
import { classifiche } from '../utils/fipsasStandings.js'

// Classifica pubblica di sola lettura, senza login: solo prove pubblicate dall'organizzatore.
// Slug inesistente e prova non pubblica rispondono allo stesso modo (404).
export default async function fipsasPublicRoutes(app) {
  app.get('/:slug', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } }
  }, async (req, reply) => {
    const slug = String(req.params.slug || '')
    const prova = /^[\w-]{6,40}$/.test(slug) ? await FipsasProva.findOne({ slug, isPublic: true }).lean() : null
    if (!prova) return reply.status(404).send({ error: 'Link non valido' })
    const cl = await classifiche(prova)
    const body = {
      prova: {
        organizzazione: prova.organizzazione, manifestazione: prova.manifestazione, provaNumero: prova.provaNumero,
        campoDiGara: prova.campoDiGara, data: prova.data, societaOrganizzatrice: prova.societaOrganizzatrice,
        direttoreDiGara: prova.direttoreDiGara, giudiceDiGara: prova.giudiceDiGara, titoli: prova.titoli, status: prova.status
      },
      ...cl
    }
    const etag = '"' + createHash('sha1').update(JSON.stringify(body)).digest('hex') + '"'
    reply.header('Cache-Control', 'public, max-age=30').header('ETag', etag)
    if (req.headers['if-none-match'] === etag) return reply.status(304).send()
    return body
  })
}
