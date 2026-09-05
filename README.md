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

## Futuro
- Auth: interceptor JWT pronto in `utils/api.js` del client, campo `userId` già nello schema
- Redis: cacheable per stats e sessioni recenti
- S3/R2: sostituire `./uploads` con un plugin Fastify per object storage
- MQTT: per sync real-time se si aggiunge la versione mobile nativa
