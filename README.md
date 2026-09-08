# fishlog-server

Backend Fastify + MongoDB per l'app di log delle uscite di pesca.

## Stack
- **Fastify** — HTTP server
- **MongoDB** + **Mongoose** — database
- **@fastify/multipart** — upload foto/video
- **@fastify/static** — serve i file uploadati

## Requisiti
- Node **>= 20** (Fastify 5 richiede `diagnostics_channel.tracingChannel`, assente su Node 18.16 e precedenti). Versione consigliata in `.nvmrc` (`nvm use`).
- MongoDB in esecuzione su `mongodb://localhost:27017` (o quanto configurato).

## Setup

```bash
npm install
cp config/local.json.example config/local.json   # imposta jwt.secret (obbligatorio) e oauth.* se servono
npm run dev            # avvia con node --watch (riavvio automatico)
```

## Config

La configurazione usa [`node-config`](https://www.npmjs.com/package/config), non `.env`: `config/default.json` contiene i default committati, `config/local.json` (gitignored) sovrascrive i segreti locali. Il server rifiuta l'avvio se `jwt.secret` non viene impostato in `local.json`.

| Chiave                  | Dove                  | Note                                    |
|--------------------------|-----------------------|------------------------------------------|
| `api.port` / `api.host`  | `default.json`        | Porta/host HTTP                          |
| `mongodb.url`            | `default.json`        | Connection string MongoDB                |
| `client.url`             | `default.json`        | Origin CORS del client Vue                |
| `app.dirs.uploads`       | `default.json`        | Cartella file media                       |
| `jwt.secret` / `jwt.expiresIn` | `local.json` (obbligatorio) | Segreto/scadenza token JWT       |
| `oauth.google.*`         | `local.json` (opzionale) | Credenziali OAuth Google                |
| `oauth.facebook.*`       | `local.json` (opzionale) | Credenziali OAuth Facebook              |

## API

### Sessioni
| Metodo | Endpoint                  | Descrizione                        |
|--------|---------------------------|------------------------------------|
| GET    | `/api/sessions`           | Lista (filtri: search, technique, dateFrom, dateTo, page, limit) |
| GET    | `/api/sessions/stats`     | Statistiche aggregate              |
| GET    | `/api/sessions/:id`       | Dettaglio singola sessione         |
| POST   | `/api/sessions`           | Crea nuova sessione                |
| PATCH  | `/api/sessions/:id`       | Aggiorna campi                     |
| DELETE | `/api/sessions/:id`       | Elimina sessione                   |

### Media
| Metodo | Endpoint                              | Descrizione                  |
|--------|---------------------------------------|------------------------------|
| POST   | `/api/media/upload/:sessionId`        | Upload foto/video (multipart)|
| DELETE | `/api/media/:sessionId/:mediaId`      | Elimina singolo file         |
| PATCH  | `/api/media/:sessionId/:mediaId/caption` | Aggiorna didascalia       |

## Struttura
```
src/
  index.js          — entry point Fastify
  models/
    Session.js      — schema Mongoose completo
  routes/
    sessions.js     — CRUD sessioni
    media.js        — upload e gestione media
uploads/            — file caricati (ignorati da git)
```

## Sicurezza in produzione

Misure già presenti nel codice:
- Header di sicurezza HTTP (`@fastify/helmet`: HSTS, X-Content-Type-Options, Referrer-Policy, ecc.)
- Rate limiting globale e più stretto sulle rotte di autenticazione (`@fastify/rate-limit`), contro brute-force e credential stuffing
- Password con hashing bcrypt (mai in chiaro), minimo 8 caratteri
- Validazione dei tipi sugli input di autenticazione (anti NoSQL injection su `email`/`password`)
- Escape dei caratteri regex nelle ricerche testuali (anti ReDoS)
- Cancellazione ed esportazione dati self-service (`DELETE /api/auth/me`, `GET /api/auth/me/export`) per i diritti GDPR di cancellazione e portabilità
- Consenso a Termini/Privacy tracciato in fase di registrazione (`acceptedTermsAt`)
- Handler d'errore globale che non espone stack trace/dettagli interni ai client

Cosa va configurato/verificato prima del go-live:
- **HTTPS obbligatorio**: il server Fastify non termina TLS da solo. Mettilo dietro un reverse proxy (nginx, Caddy, load balancer del provider) con certificato valido e redirect automatico da HTTP a HTTPS.
- **`api.trustProxy`**: se il server sta dietro un reverse proxy, impostalo a `true` in `config/local.json` (o `config/prod.json`), altrimenti rate limiting e log useranno l'IP del proxy invece di quello reale del client.
- **`jwt.secret`**: genera un segreto lungo e casuale (es. `openssl rand -hex 32`), mai quello di esempio.
- **SMTP**: configuralo per abilitare reset password e notifiche via email (necessario per `features.passwordAuth`).
- **Backup del database MongoDB**: pianifica backup regolari, i dati includono contenuti personali degli utenti.
- **Testi legali**: i placeholder `[NOME/RAGIONE SOCIALE DEL TITOLARE]`, `[INDIRIZZO COMPLETO]`, `[CF/P.IVA]` ed `[EMAIL DI CONTATTO PRIVACY]` nelle pagine Privacy/Termini del client (`fishlog-client/src/views/legal/`) vanno completati con i dati reali del gestore del servizio prima della pubblicazione: sono richiesti dall'art. 13 GDPR.

## Futuro
- Auth: interceptor JWT pronto in `utils/api.js` del client, campo `userId` già nello schema
- Redis: cacheable per stats e sessioni recenti
- S3/R2: sostituire `./uploads` con un plugin Fastify per object storage
- MQTT: per sync real-time se si aggiunge la versione mobile nativa
