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

Dopo ogni modifica a `config/local.json` (es. una nuova chiave) il server va riavviato (`pm2 restart fishlog-server`) per rileggerla.

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

## Dati di test (seeder)

Per provare l'app con dati realistici, senza dump:

```bash
npm run seed          # crea (o ricrea) i dati di test
npm run seed:clean    # cancella solo i dati di test
npm run seed:clean -- --dry-run   # mostra cosa verrebbe cancellato
```

Usa il database di `mongodb.url` (stessa config del server, serve `config/local.json`). Crea 8 utenti (due con lo stesso nome visualizzato «Mario Rossi», un negozio verificato, un admin), amicizie accettate e in attesa, 3 gruppi, ~50 uscite su mare e laghi italiani con coordinate reali (ultimi 7 giorni, 30 giorni, anno e storico, pubbliche/private/di gruppo, con catture, specie, peso, lunghezza e foto segnaposto), post ed evento nel Social, storie, 8 annunci Market (visibilità Tutti/Amici/Gruppi, stati diversi, visualizzazioni) e 3 chat con notifiche. Le uscite pubbliche alimentano la classifica per settimana/mese/anno.

Al termine stampa le credenziali: **password `Test1234!` per tutti**, email `<username>@fishlog.test` (es. `mario.rossi@fishlog.test`).

Sicurezza:
- Ogni documento creato ha `seed: true` e le foto segnaposto in `uploads/` hanno prefisso `seed_`. `seed:clean` rimuove solo questi e ciò che gli utenti di test hanno creato dall'app (uscite, post, annunci, chat, ecc.); non tocca altri utenti né altri file.
- `seed` è idempotente: ripulisce i propri dati precedenti prima di ricrearli, quindi rilanciarlo non duplica nulla. Si ferma se esiste un utente non-seed con le stesse email/username.
- Rifiuta di girare con `NODE_ENV=production` salvo `--allow-production` (es. `npm run seed -- --allow-production`).
- Le storie durano 24 ore (TTL): rilancia `npm run seed` per rigenerarle.

## Struttura
```
src/
  index.js          — entry point Fastify
  models/
    Session.js      — schema Mongoose completo
  routes/
    sessions.js     — CRUD sessioni
    media.js        — upload e gestione media
scripts/seed.js     — seeder dati di test (npm run seed / seed:clean)
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
- **HTTPS + `api.trustProxy`**: il sito gira dietro un reverse proxy che termina TLS. `api.trustProxy` è `true` di default in `config/default.json`, così Fastify legge l'IP reale del client da `X-Forwarded-For` (rate limiting e log corretti) invece di quello del proxy, e riconosce la richiesta come HTTPS. Se in futuro il server tornasse a essere esposto direttamente (senza proxy davanti), reimposta `api.trustProxy: false` in `config/local.json`, altrimenti un client potrebbe falsificare il proprio IP con quell'header.

Cosa va ancora configurato/verificato prima del go-live:
- **`jwt.secret`**: genera un segreto lungo e casuale (es. `openssl rand -hex 32`), mai quello di esempio.
- **SMTP**: configuralo per abilitare reset password e notifiche via email (necessario per `features.passwordAuth`).
- **Backup del database MongoDB**: pianifica backup regolari, i dati includono contenuti personali degli utenti.
- **Dati legali**: nome/ragione sociale, indirizzo, CF/P.IVA ed email di contatto del Titolare del trattamento vanno compilati da Admin → Configurazioni → "Dati legali (Privacy/Termini)": finché restano vuoti, le pagine Privacy/Termini del client mostrano un segnaposto (richiesti dall'art. 13 GDPR).

## Futuro
- Auth: interceptor JWT pronto in `utils/api.js` del client, campo `userId` già nello schema
- Redis: cacheable per stats e sessioni recenti
- S3/R2: sostituire `./uploads` con un plugin Fastify per object storage
- MQTT: per sync real-time se si aggiunge la versione mobile nativa
