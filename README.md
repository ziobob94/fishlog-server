# fishlog-server

Backend Fastify + MongoDB per l'app di log delle uscite di pesca.

## Stack
- **Fastify** — HTTP server
- **MongoDB** + **Mongoose** — database
- **@fastify/multipart** — upload foto/video
- **@fastify/static** — serve i file uploadati

## Setup

```bash
npm install
cp .env.example .env   # modifica MONGODB_URI se necessario
npm run dev            # avvia con node --watch (riavvio automatico)
```

## .env

| Variabile       | Default                                    | Note                         |
|-----------------|--------------------------------------------|------------------------------|
| `PORT`          | `3001`                                     |                              |
| `MONGODB_URI`   | `mongodb://localhost:27017/fishlog`    |                              |
| `UPLOADS_DIR`   | `./uploads`                                | Cartella file media          |
| `CLIENT_ORIGIN` | `http://localhost:5173`                    | Origin CORS del client Vue   |

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
