import crypto from 'crypto'
import AppConfig from '../config.js'

const cfg = new AppConfig()

// Endpoint richiesto da eBay ("Marketplace Account Deletion / Closure
// Notification") per attivare il keyset di produzione: senza un endpoint
// registrato (o un'esenzione approvata), eBay disabilita il keyset e ogni
// richiesta token torna 401, a prescindere da quanto siano corrette le
// credenziali — vedi utils/ebay.js.
//
// Fishlog non salva alcun dato legato ad account eBay (solo ricerca
// pubblica nel catalogo via client-credentials, nessun token utente eBay),
// quindi non c'è nulla da cancellare quando arriva una notifica: basta
// rispondere alla verifica dell'endpoint e confermare la ricezione.
export default async function ebayNotificationRoutes(app) {

  // eBay valida l'endpoint con una GET ?challenge_code=... e si aspetta
  // sha256(challengeCode + verificationToken + endpointUrl) in risposta.
  // L'endpointUrl deve combaciare esattamente (schema/host/path) con quello
  // registrato nel Developer Portal.
  app.get('/marketplace-account-deletion', async (req, reply) => {
    const { challenge_code: challengeCode } = req.query
    if (!challengeCode) return reply.status(400).send({ error: 'challenge_code mancante' })

    const token = cfg.get('ebay.verificationToken', '').trim()
    const endpointUrl = `${req.protocol}://${req.headers.host}/api/ebay/marketplace-account-deletion`

    const challengeResponse = crypto.createHash('sha256')
      .update(challengeCode + token + endpointUrl)
      .digest('hex')

    return reply.header('Content-Type', 'application/json').send({ challengeResponse })
  })

  // Notifica vera e propria di cancellazione/chiusura account eBay: nessun
  // dato da eliminare lato nostro, si conferma solo la ricezione.
  app.post('/marketplace-account-deletion', async (req, reply) => {
    req.log.info({ body: req.body }, 'eBay marketplace account deletion notification received')
    return reply.status(200).send()
  })
}
