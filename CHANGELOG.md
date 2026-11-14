# [1.43.0](https://github.com/ziobob94/fishlog-server/compare/server-v1.42.0...server-v1.43.0) (2026-11-14)


### Features

* **meteo:** attività dei pesci «adesso» per Home e località ([#41](https://github.com/ziobob94/fishlog-server/issues/41)) ([0b04b3e](https://github.com/ziobob94/fishlog-server/commit/0b04b3ec1f4ccaf5862296eeabad9b704c37ddd8))

# [1.42.0](https://github.com/ziobob94/fishlog-server/compare/server-v1.41.0...server-v1.42.0) (2026-11-14)


### Features

* **assistant:** Fishy, assistente vocale generico (inizia uscita, cattura, esca, fine uscita) ([#40](https://github.com/ziobob94/fishlog-server/issues/40)) ([8ec7898](https://github.com/ziobob94/fishlog-server/commit/8ec7898b6a4b53f279b943e02405bb585014d00f))

# [1.41.0](https://github.com/ziobob94/fishlog-server/compare/server-v1.40.1...server-v1.41.0) (2026-11-14)


### Features

* **sessions:** catture a voce con Gemini gratuito (provider configurabile) ([#38](https://github.com/ziobob94/fishlog-server/issues/38)) ([7df32b4](https://github.com/ziobob94/fishlog-server/commit/7df32b4692590f732c0b962d004f748efbab6499))

## [1.40.1](https://github.com/ziobob94/fishlog-server/compare/server-v1.40.0...server-v1.40.1) (2026-11-14)


### Bug Fixes

* **deploy:** ripulisce node_modules prima di npm ci (ENOTEMPTY lasciava il server senza dipendenze) ([#37](https://github.com/ziobob94/fishlog-server/issues/37)) ([cc331fe](https://github.com/ziobob94/fishlog-server/commit/cc331fe0132a661af7da7ba70c9f395444dab7b8))

# [1.40.0](https://github.com/ziobob94/fishlog-server/compare/server-v1.39.0...server-v1.40.0) (2026-11-14)


### Features

* **me:** località preferite (GET/PUT /api/me/favorite-places) e meteo/mare in batch (POST /api/weather/batch) ([#36](https://github.com/ziobob94/fishlog-server/issues/36)) ([0c4e8d3](https://github.com/ziobob94/fishlog-server/commit/0c4e8d3c44aeb44c641d3b100ff81056b1ceead3))
* **sessions:** catture a voce interpretate con Claude ([#35](https://github.com/ziobob94/fishlog-server/issues/35)) ([4dadfa5](https://github.com/ziobob94/fishlog-server/commit/4dadfa5b3f21f7307d9a680117427c7386b255bd))

# [1.39.0](https://github.com/ziobob94/fishlog-server/compare/server-v1.38.0...server-v1.39.0) (2026-11-13)


### Features

* **species:** /search segnala l'alias trovato (matchedAlias) ([#33](https://github.com/ziobob94/fishlog-server/issues/33)) ([454ed8c](https://github.com/ziobob94/fishlog-server/commit/454ed8c2599058c7f97eee0e8e309d431091509c))

# [1.38.0](https://github.com/ziobob94/fishlog-server/compare/server-v1.37.0...server-v1.38.0) (2026-11-13)


### Features

* **gare:** formato FIPSAS surf casting, calcolo classifiche, rotte e PDF ([#34](https://github.com/ziobob94/fishlog-server/issues/34)) ([971c6ac](https://github.com/ziobob94/fishlog-server/commit/971c6acb49d35632f4c792f41dd2fb0e5f867196))

# [1.37.0](https://github.com/ziobob94/fishlog-server/compare/server-v1.36.0...server-v1.37.0) (2026-11-12)


### Features

* **species:** catalogo curato di 120 specie con nomi italiani, alias e descrizioni ([#32](https://github.com/ziobob94/fishlog-server/issues/32)) ([c760b38](https://github.com/ziobob94/fishlog-server/commit/c760b3855026c06c9716e43f6482288de2739460))

# [1.36.0](https://github.com/ziobob94/fishlog-server/compare/server-v1.35.0...server-v1.36.0) (2026-11-12)


### Features

* **posts:** hashtag estratti da titolo e testo, filtro ?tag= e endpoint /posts/tags ([#31](https://github.com/ziobob94/fishlog-server/issues/31)) ([a59e97b](https://github.com/ziobob94/fishlog-server/commit/a59e97b22099cfaad77681a03d2e4f2cbe1b5111))

# [1.35.0](https://github.com/ziobob94/fishlog-server/compare/server-v1.34.0...server-v1.35.0) (2026-11-12)


### Features

* **posts:** like, risposte e reazioni ai commenti ([d9db5fd](https://github.com/ziobob94/fishlog-server/commit/d9db5fdc6336b10039674b4b2f8a43cba82bba86))

# [1.34.0](https://github.com/ziobob94/fishlog-server/compare/server-v1.33.1...server-v1.34.0) (2026-11-12)


### Features

* **meteo:** ICON-2I come fonte principale per l'Italia ([52c6ab2](https://github.com/ziobob94/fishlog-server/commit/52c6ab253d88693de7dce9da9076357bce922d68))

## [1.33.1](https://github.com/ziobob94/fishlog-server/compare/server-v1.33.0...server-v1.33.1) (2026-11-12)


### Bug Fixes

* link email nuovo commento/like alla rotta /post/:id ([#28](https://github.com/ziobob94/fishlog-server/issues/28)) ([36a82ee](https://github.com/ziobob94/fishlog-server/commit/36a82eecbd1f3c6b54fdd95cd610ea72b6c5810a))

# [1.33.0](https://github.com/ziobob94/fishlog-server/compare/server-v1.32.2...server-v1.33.0) (2026-11-12)


### Features

* elenco alfabetico delle specie per la scheda «Tutte» ([f4187fd](https://github.com/ziobob94/fishlog-server/commit/f4187fdc05bb49051d02755bff60842f0fea273a))
* endpoint «In stagione» per le specie (stagione per mese e zona) ([eb0919c](https://github.com/ziobob94/fishlog-server/commit/eb0919cf08de74b08e2785957787ebd65d84646a))

## [1.32.2](https://github.com/ziobob94/fishlog-server/compare/server-v1.32.1...server-v1.32.2) (2026-11-12)


### Bug Fixes

* conteggi della Classifica (media delle catture, uscite e catture nel podio) ([2634902](https://github.com/ziobob94/fishlog-server/commit/2634902fe7bed8733ab11810ed1499a1369781bf))
* la Classifica esclude le uscite ancora in corso ([fe1b0ff](https://github.com/ziobob94/fishlog-server/commit/fe1b0ff80a6972114fc8d80668263dd571199473))

## [1.32.1](https://github.com/ziobob94/fishlog-server/compare/server-v1.32.0...server-v1.32.1) (2026-11-11)


### Bug Fixes

* attività dei pesci completa anche per le ore residue di oggi ([c315a2a](https://github.com/ziobob94/fishlog-server/commit/c315a2ad56830f20f1db64df36af787af0b18f67))

# [1.32.0](https://github.com/ziobob94/fishlog-server/compare/server-v1.31.1...server-v1.32.0) (2026-11-11)


### Features

* meteo 7 giorni orari e mare, codici WMO e attività dei pesci ([5e7ab33](https://github.com/ziobob94/fishlog-server/commit/5e7ab33e19c97e678986c23208435303fef23db8))

## [1.31.1](https://github.com/ziobob94/fishlog-server/compare/server-v1.31.0...server-v1.31.1) (2026-11-11)


### Bug Fixes

* **chat:** apri sempre una conversazione già esistente, il permesso serve solo per iniziarla ([2cdbccd](https://github.com/ziobob94/fishlog-server/commit/2cdbccd96d8faad7d0128f62e758d6751c4fc4e7))

# [1.31.0](https://github.com/ziobob94/fishlog-server/compare/server-v1.30.0...server-v1.31.0) (2026-11-11)


### Features

* contatori nel profilo utente e filtro userId sulle uscite ([3ba6484](https://github.com/ziobob94/fishlog-server/commit/3ba64845eb617712eab4018f3eb911c11593ff22))
* endpoint GET /users/:id/catches con classifica, record e totali ([321be6c](https://github.com/ziobob94/fishlog-server/commit/321be6cfa6b71f49ba4869e97866d49121d6bb60))

# [1.30.0](https://github.com/ziobob94/fishlog-server/compare/server-v1.29.1...server-v1.30.0) (2026-11-11)


### Bug Fixes

* ordina le uscite dalla più recente anche a parità di data ([856be21](https://github.com/ziobob94/fishlog-server/commit/856be21e6ef62cfae014952620227d50931b4ee9))


### Features

* seeder di dati di test (npm run seed / seed:clean) ([9d129d6](https://github.com/ziobob94/fishlog-server/commit/9d129d6d21593236a0634d7e71552d2db19a655c))

## [1.29.1](https://github.com/ziobob94/fishlog-server/compare/server-v1.29.0...server-v1.29.1) (2026-11-11)


### Bug Fixes

* conteggio visualizzazioni storie ([082b241](https://github.com/ziobob94/fishlog-server/commit/082b241a94088ccf602443a6c057e87d421272dd))

# [1.29.0](https://github.com/ziobob94/fishlog-server/compare/server-v1.28.0...server-v1.29.0) (2026-11-11)


### Features

* meteo ora per ora fino a 7 giorni e previsioni a 15 giorni (Google + Open-Meteo) ([6a90aff](https://github.com/ziobob94/fishlog-server/commit/6a90aff6cbc4ed430758571b031e129c2d08aeb7))

# [1.28.0](https://github.com/ziobob94/fishlog-server/compare/server-v1.27.0...server-v1.28.0) (2026-11-11)


### Features

* onda ora per ora (altezza e periodo, 48 h) in /api/weather ([14529fc](https://github.com/ziobob94/fishlog-server/commit/14529fcc105b29f0acb21d7c7f16d96ddfc03ce9))

# [1.27.0](https://github.com/ziobob94/fishlog-server/compare/server-v1.26.0...server-v1.27.0) (2026-11-11)


### Features

* avvisi e blocco automatico sulla quota Google Weather ([d0525a1](https://github.com/ziobob94/fishlog-server/commit/d0525a164022b064db17f18af79f10ee7d23b97c))
* destinatario configurabile per gli avvisi di quota Google Weather ([7bf2e00](https://github.com/ziobob94/fishlog-server/commit/7bf2e006be3d5f635c7d2202ac4360bb5305538c))
* endpoint /api/weather/overview con meteo, previsioni, mare e dati utili alla pesca ([32bd76a](https://github.com/ziobob94/fishlog-server/commit/32bd76a614decf89800c22a3c5dade9efdf8713e))
* quota Google Weather (griglia 0,05°, TTL più lunghi, contatore mensile con soglia all'80%) ([8ff86db](https://github.com/ziobob94/fishlog-server/commit/8ff86dbddb3c146d0823ac39895a4554ce0b1542))
* storico pressione 6 h, onda massima giornaliera e alias GET /api/weather?lat&lon ([257ab01](https://github.com/ziobob94/fishlog-server/commit/257ab013dd365bdbf770756f423c7f91d05891c9))

# [1.26.0](https://github.com/ziobob94/fishlog-server/compare/server-v1.25.0...server-v1.26.0) (2026-11-11)


### Features

* meteo da Google Weather API lato server (/api/weather), Open-Meteo solo per mare e ripiego ([6ecb627](https://github.com/ziobob94/fishlog-server/commit/6ecb627addcc537ce77a4a6705dcbe65487b2838))

# [1.25.0](https://github.com/ziobob94/fishlog-server/compare/server-v1.24.0...server-v1.25.0) (2026-11-11)


### Features

* visibilità annunci (tutti/amici/gruppi), contatto venditore opt-in, visualizzazioni uniche ([ce953cd](https://github.com/ziobob94/fishlog-server/commit/ce953cd59d02d7db472e6e8b809cc94d26580588))

# [1.24.0](https://github.com/ziobob94/fishlog-server/compare/server-v1.23.0...server-v1.24.0) (2026-11-10)


### Features

* **market:** i privati possono pubblicare senza verifica, solo i negozi richiedono la verifica ([55dc147](https://github.com/ziobob94/fishlog-server/commit/55dc147cce0bc2787c47e3460a3c3def5ced56c2))

# [1.23.0](https://github.com/ziobob94/fishlog-server/compare/server-v1.22.0...server-v1.23.0) (2026-11-10)


### Features

* logo del negozio, uscita collegata e cattura in evidenza nei post ([5812b12](https://github.com/ziobob94/fishlog-server/commit/5812b1209bcfd08841dd8a0b324c1d0607df0701))
* **notifiche:** notifiche in app per mi piace e commenti ai post ([3f08ecd](https://github.com/ziobob94/fishlog-server/commit/3f08ecd994ca405ea1bcf60d9ab4fa983bf77769))

# [1.22.0](https://github.com/ziobob94/fishlog-server/compare/server-v1.21.0...server-v1.22.0) (2026-11-10)


### Features

* **shop:** upload del documento di verifica (privato) e visione admin; dati negozio non pubblici ([9f2c18a](https://github.com/ziobob94/fishlog-server/commit/9f2c18a83cda1fb06e31c178a876e16c1b099084))

# [1.21.0](https://github.com/ziobob94/fishlog-server/compare/server-v1.20.0...server-v1.21.0) (2026-11-09)


### Features

* **market:** pubblicare annunci richiede un venditore verificato ([9ff7649](https://github.com/ziobob94/fishlog-server/commit/9ff7649114722c2b70ed6831684a2a8a6de6d954))
* **sessions:** filtro mine=true per elencare solo le proprie uscite ([5c41859](https://github.com/ziobob94/fishlog-server/commit/5c418590eca2858dde84229137943c41674e8059))
* **shop:** dati venditore, motivo del rifiuto e richiesta sito per il negozio ([2ac1409](https://github.com/ziobob94/fishlog-server/commit/2ac1409aeba5cf33d964cd47d072d1d1f55ea48f))
* **stats:** catture per mese (12 mesi) e specie più catturate in /sessions/stats ([6cd4770](https://github.com/ziobob94/fishlog-server/commit/6cd4770df51334753c426924399f72422b203338))

# [1.20.0](https://github.com/ziobob94/fishlog-server/compare/server-v1.19.0...server-v1.20.0) (2026-10-07)


### Features

* classifica leggera su contenuto pubblico ([af281ea](https://github.com/ziobob94/fishlog-server/commit/af281ea0ca0066bed9d8f16a2b6739aff15433a0))

# [1.19.0](https://github.com/ziobob94/fishlog-server/compare/server-v1.18.0...server-v1.19.0) (2026-10-07)


### Features

* normativa con fonte citata (taglie minime, fermi, specie protette) ([386b7fe](https://github.com/ziobob94/fishlog-server/commit/386b7fe3e51b8c983cbde5251f586a2369727aac))

# [1.18.0](https://github.com/ziobob94/fishlog-server/compare/server-v1.17.0...server-v1.18.0) (2026-10-07)


### Features

* suggeritore attrezzatura dai dati reali (filtri su scheda specie) ([9188581](https://github.com/ziobob94/fishlog-server/commit/9188581fffeae6a06c4a0751f574cd4928988ef2))

# [1.17.0](https://github.com/ziobob94/fishlog-server/compare/server-v1.16.0...server-v1.17.0) (2026-10-07)


### Features

* scheda specie pubblica con calendario ed esche dai dati reali ([5920f62](https://github.com/ziobob94/fishlog-server/commit/5920f624708cd9374fc605aa0d0245190f8f9187))

# [1.16.0](https://github.com/ziobob94/fishlog-server/compare/server-v1.15.3...server-v1.16.0) (2026-09-10)


### Features

* market in 3 tab distinte (Annunci / Negozi / eBay) ([ba856e7](https://github.com/ziobob94/fishlog-server/commit/ba856e7b26e6e862d2c9a9cff4cec37cd52c334c))

## [1.15.3](https://github.com/ziobob94/fishlog-server/compare/server-v1.15.2...server-v1.15.3) (2026-09-09)


### Bug Fixes

* filtri e paginazione dei risultati eBay nel market ([264cdbb](https://github.com/ziobob94/fishlog-server/commit/264cdbb57b12d5937c6ee666c3bfd2389898d7f0))

## [1.15.2](https://github.com/ziobob94/fishlog-server/compare/server-v1.15.1...server-v1.15.2) (2026-09-09)


### Bug Fixes

* spunte di lettura sparite sui messaggi precedenti ai gruppi ([2b20eef](https://github.com/ziobob94/fishlog-server/commit/2b20eef4b2d9ab057f80ff75f3279f85e6361b98))

## [1.15.1](https://github.com/ziobob94/fishlog-server/compare/server-v1.15.0...server-v1.15.1) (2026-09-09)


### Bug Fixes

* chat dirette duplicate dopo l'introduzione dei gruppi ([766d455](https://github.com/ziobob94/fishlog-server/commit/766d4557babbf3c73d2fb4eafd257ac6d1da7a42))

# [1.15.0](https://github.com/ziobob94/fishlog-server/compare/server-v1.14.0...server-v1.15.0) (2026-09-09)


### Features

* chat di gruppo (server) ([68afc12](https://github.com/ziobob94/fishlog-server/commit/68afc124b163c3a5f0afca769cda13cb54056a92))
* link diretto ai gruppi nelle notifiche di chat ([cef240b](https://github.com/ziobob94/fishlog-server/commit/cef240b7fd082765df95250cfb0943f3810c12f0))

# [1.14.0](https://github.com/ziobob94/fishlog-server/compare/server-v1.13.0...server-v1.14.0) (2026-09-09)


### Features

* conversazioni preferite (personali, per la nuova tab del client) ([7678c55](https://github.com/ziobob94/fishlog-server/commit/7678c55c647f74b1337686d860aba745da6f1461))

# [1.13.0](https://github.com/ziobob94/fishlog-server/compare/server-v1.12.0...server-v1.13.0) (2026-09-09)


### Features

* endpoint pubblico per l'elenco dei negozi verificati ([9bbd947](https://github.com/ziobob94/fishlog-server/commit/9bbd947629a72dc37c9ea1df5074dd33b5dc4ace))

# [1.12.0](https://github.com/ziobob94/fishlog-server/compare/server-v1.11.2...server-v1.12.0) (2026-09-09)


### Features

* endpoint di notifica "Marketplace Account Deletion" per eBay ([9f79aeb](https://github.com/ziobob94/fishlog-server/commit/9f79aeb5190eec611995aff00a29409eda6a21d9))

## [1.11.2](https://github.com/ziobob94/fishlog-server/compare/server-v1.11.1...server-v1.11.2) (2026-09-09)


### Bug Fixes

* trim su client ID/secret eBay e messaggio d'errore più utile ([0e30057](https://github.com/ziobob94/fishlog-server/commit/0e30057cab7fc52c12c11cc4e40a69769eef4a82))

## [1.11.1](https://github.com/ziobob94/fishlog-server/compare/server-v1.11.0...server-v1.11.1) (2026-09-09)


### Bug Fixes

* distingui errore reale da zero risultati nella ricerca eBay del market ([d80b859](https://github.com/ziobob94/fishlog-server/commit/d80b859bf0bd3d90975f0ed77f721aec3112570e))

# [1.11.0](https://github.com/ziobob94/fishlog-server/compare/server-v1.10.0...server-v1.11.0) (2026-09-08)


### Features

* personalizza la ricerca eBay del market in base alla tecnica di pesca ([699abef](https://github.com/ziobob94/fishlog-server/commit/699abefebec78afe2cd87c4e36b63a1f8eb6a45f))
* preferenze market esplicite (sondaggio + profilo) ([6f822a8](https://github.com/ziobob94/fishlog-server/commit/6f822a871d55fc80f206d08d8e449ccb6c73e390))

# [1.10.0](https://github.com/ziobob94/fishlog-server/compare/server-v1.9.0...server-v1.10.0) (2026-09-07)


### Features

* aggiungi verifica admin per l'attivazione della modalità negozio ([15c5856](https://github.com/ziobob94/fishlog-server/commit/15c5856a5e163996ad8e49636e119214ee4c6897))

# [1.9.0](https://github.com/ziobob94/fishlog-server/compare/server-v1.8.0...server-v1.9.0) (2026-09-07)


### Features

* aggiungi market (annunci P2P, vetrine negozio, fallback eBay) ([0719e66](https://github.com/ziobob94/fishlog-server/commit/0719e66c72ff86fc8f3ff2cf818c8cf8bde23ce8))

# [1.8.0](https://github.com/ziobob94/fishlog-server/compare/server-v1.7.0...server-v1.8.0) (2026-09-06)


### Features

* modifica ed eliminazione messaggi chat ([ef14edd](https://github.com/ziobob94/fishlog-server/commit/ef14edd718df83b22499a748a56049d669d5a4c4))

# [1.7.0](https://github.com/ziobob94/fishlog-server/compare/server-v1.6.0...server-v1.7.0) (2026-09-06)


### Features

* chat completa - media, file, posizione, vocali ([9c453ef](https://github.com/ziobob94/fishlog-server/commit/9c453ef4514e68c8bb3cbfb945db2035d933d311))

# [1.6.0](https://github.com/ziobob94/fishlog-server/compare/server-v1.5.1...server-v1.6.0) (2026-09-06)


### Features

* elimina singola notifica o svuota il centro notifiche ([ddf772a](https://github.com/ziobob94/fishlog-server/commit/ddf772a037acfe1d4b2065b98be95fbba6cb18b0))

## [1.5.1](https://github.com/ziobob94/fishlog-server/compare/server-v1.5.0...server-v1.5.1) (2026-09-06)


### Bug Fixes

* segna letta la notifica chat anche aprendo la chat direttamente ([fc09260](https://github.com/ziobob94/fishlog-server/commit/fc09260b588504a4210fd0525a0980136d6edb59))

# [1.5.0](https://github.com/ziobob94/fishlog-server/compare/server-v1.4.1...server-v1.5.0) (2026-09-06)


### Features

* aggiungi notifiche realtime via websocket ([be4fa96](https://github.com/ziobob94/fishlog-server/commit/be4fa96d4749d4df3df22c84f33fae66c7f89db1))

## [1.4.1](https://github.com/ziobob94/fishlog-server/compare/server-v1.4.0...server-v1.4.1) (2026-09-06)


### Bug Fixes

* pulisci amicizie e chat alla cancellazione account ([6658613](https://github.com/ziobob94/fishlog-server/commit/665861374b868c6378b068457338c512048573f5))

# [1.4.0](https://github.com/ziobob94/fishlog-server/compare/server-v1.3.0...server-v1.4.0) (2026-09-06)


### Features

* Aggiungi supporto per il testo delle email per migliorare la compatibilità con i filtri antispam ([65ff0e3](https://github.com/ziobob94/fishlog-server/commit/65ff0e3f8bf5350970cfed48926ac59ddcbe6298))

# [1.3.0](https://github.com/ziobob94/fishlog-server/compare/server-v1.2.0...server-v1.3.0) (2026-09-06)


### Features

* Aggiungi supporto per le notifiche email e nuovi template per le email ([cda22dc](https://github.com/ziobob94/fishlog-server/commit/cda22dc2d0e792094b751b7ea4dd976a3ca985b6))

# [1.2.0](https://github.com/ziobob94/fishlog-server/compare/server-v1.1.0...server-v1.2.0) (2026-09-05)


### Bug Fixes

* allinea config a jwt/oauth reali, protegge rotte media, fix avvio dev ([ec194ec](https://github.com/ziobob94/fishlog-server/commit/ec194ec74b231b3e129623d5aa5198b1456bf8f7))


### Features

* **auth:** gestione profilo, avatar, reset password e cambio email via mail ([365d309](https://github.com/ziobob94/fishlog-server/commit/365d30906a97d70ba82a73d27d7f297954002856))
* **posts:** feed social con post collegati a sessioni/catture ([daf91a7](https://github.com/ziobob94/fishlog-server/commit/daf91a7dc8076091af34aacbec438f2f3723edaa))
* **species:** catalogo specie con dati da GBIF e iNaturalist ([07ab197](https://github.com/ziobob94/fishlog-server/commit/07ab1979cc189fc5084a9040f9b1fc1d55c28593))

# [1.1.0](https://github.com/ziobob94/fishlog-server/compare/server-v1.0.0...server-v1.1.0) (2026-04-17)


### Features

* locations ([04cb5a1](https://github.com/ziobob94/fishlog-server/commit/04cb5a16b2563b9073362bab952eb2ea2d7f9cb5))

# 1.0.0 (2026-04-16)


### Bug Fixes

* remove useless files ([8a65cce](https://github.com/ziobob94/fishlog-server/commit/8a65cce3e68e035b9fbf0ff9b6a5030a7ddb9008))


### Features

* add all files ([c0dd9ed](https://github.com/ziobob94/fishlog-server/commit/c0dd9ed8c6edd90b4453cfef43385e3dac591fd9))
