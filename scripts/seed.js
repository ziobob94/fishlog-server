// Seeder di dati di test per un test completo dell'app.
//
//   npm run seed          crea (o ricrea) i dati di test
//   npm run seed:clean    cancella solo i dati di test
//
// Opzioni: --dry-run (solo clean: conta senza cancellare),
//          --allow-production (obbligatoria se NODE_ENV=production).
//
// Ogni documento creato ha `seed: true` e i file in /uploads hanno prefisso
// "seed_". Il clean rimuove i documenti marcati e quelli collegati agli utenti
// di test (creati dall'app con quegli account), mai altro.

import AppConfig from '../src/config.js'
const cfg = new AppConfig()

import path from 'path'
import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import User from '../src/models/User.js'
import Friendship from '../src/models/Friendship.js'
import Group from '../src/models/Group.js'
import Session from '../src/models/Session.js'
import Post from '../src/models/Post.js'
import Story from '../src/models/Story.js'
import Listing from '../src/models/Listing.js'
import ListingView from '../src/models/ListingView.js'
import Conversation from '../src/models/Conversation.js'
import Message from '../src/models/Message.js'
import Notification from '../src/models/Notification.js'
import { PLACEHOLDERS, writePlaceholders, removePlaceholders } from './seed/placeholders.js'
import { PASSWORD, EMAIL_DOMAIN, USERS, SPOTS, SPECIES, BAITS, TECHNIQUES, LISTINGS } from './seed/data.js'

const args = process.argv.slice(2)
const mode = args.find(a => !a.startsWith('--')) || 'seed'
const dryRun = args.includes('--dry-run')
const allowProd = args.includes('--allow-production')

const DAY = 86400000
const now = Date.now()
const oid = () => new mongoose.Types.ObjectId()

// PRNG deterministico: stessi dati a ogni esecuzione.
let _s = 20260101
const rand = () => { _s = (_s + 0x6d2b79f5) | 0; let t = Math.imul(_s ^ (_s >>> 15), 1 | _s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
const pick = a => a[Math.floor(rand() * a.length)]
const between = (a, b, dp = 1) => +(a + rand() * (b - a)).toFixed(dp)
const hhmm = h => `${String(Math.floor(h)).padStart(2, '0')}:${rand() < 0.5 ? '00' : '30'}`

// ── Inserimento marcato ────────────────────────────────────────────────────
// Passa dal modello (default e validazione), poi scrive il documento grezzo
// con `seed: true` — così non serve alcun campo nei schema di produzione.
async function insert(Model, docs) {
  const raw = docs.map(d => {
    const m = new Model(d)
    const err = m.validateSync()
    if (err) throw new Error(`${Model.modelName}: ${err.message}`)
    const o = m.toObject()
    const at = d.createdAt || new Date()
    return { ...o, seed: true, createdAt: at, updatedAt: d.updatedAt || at }
  })
  if (raw.length) await Model.collection.insertMany(raw)
  return raw
}

function guard() {
  if (process.env.NODE_ENV === 'production' && !allowProd) {
    console.error('Rifiuto di girare con NODE_ENV=production. Se sei sicuro, aggiungi --allow-production.')
    process.exit(1)
  }
}

// ── Clean ──────────────────────────────────────────────────────────────────
async function clean({ dry }) {
  const seedUsers = await User.collection.find({ seed: true }, { projection: { _id: 1 } }).toArray()
  const uids = seedUsers.map(u => u._id)
  const byUser = f => ({ $or: [{ seed: true }, ...(uids.length ? [{ [f]: { $in: uids } }] : [])] })

  const convs = await Conversation.collection.find(
    { $or: [{ seed: true }, ...(uids.length ? [{ participants: { $in: uids } }] : [])] }, { projection: { _id: 1 } }).toArray()
  const convIds = convs.map(c => c._id)
  const listings = await Listing.collection.find(byUser('seller'), { projection: { _id: 1 } }).toArray()
  const listingIds = listings.map(l => l._id)

  const plan = [
    ['messaggi',         Message,      { $or: [{ seed: true }, { conversation: { $in: convIds } }] }],
    ['conversazioni',    Conversation, { _id: { $in: convIds } }],
    ['visualizzazioni',  ListingView,  { $or: [{ seed: true }, { listing: { $in: listingIds } }, ...(uids.length ? [{ user: { $in: uids } }] : [])] }],
    ['annunci',          Listing,      { _id: { $in: listingIds } }],
    ['storie',           Story,        byUser('author')],
    ['post',             Post,         byUser('author')],
    ['uscite',           Session,      byUser('userId')],
    ['notifiche',        Notification, { $or: [{ seed: true }, ...(uids.length ? [{ recipient: { $in: uids } }, { actor: { $in: uids } }] : [])] }],
    ['amicizie',         Friendship,   { $or: [{ seed: true }, ...(uids.length ? [{ requester: { $in: uids } }, { recipient: { $in: uids } }] : [])] }],
    ['gruppi',           Group,        byUser('owner')],
    ['utenti',           User,         { seed: true }]
  ]

  let total = 0
  for (const [label, Model, filter] of plan) {
    const n = dry ? await Model.collection.countDocuments(filter) : (await Model.collection.deleteMany(filter)).deletedCount
    total += n
    console.log(`  ${dry ? 'da cancellare' : 'cancellati'}: ${String(n).padStart(4)} ${label}`)
  }
  if (!dry) {
    const files = await removePlaceholders(path.resolve(cfg.get('app.dirs.uploads')))
    console.log(`  cancellati: ${String(files).padStart(4)} file segnaposto in uploads/`)
  }
  return total
}

// ── Seed ───────────────────────────────────────────────────────────────────
async function seed() {
  const uploads = path.resolve(cfg.get('app.dirs.uploads'))
  const base = `http://${cfg.get('api.host')}:${cfg.get('api.port')}`

  // Evita di sovrascrivere/collidere con utenti reali.
  const emails = USERS.map(u => `${u.username}@${EMAIL_DOMAIN}`)
  const clash = await User.collection.findOne({
    seed: { $ne: true }, $or: [{ email: { $in: emails } }, { username: { $in: USERS.map(u => u.username) } }]
  })
  if (clash) throw new Error(`Esiste già un utente non-seed con email/username ${clash.email || clash.username}: interrompo.`)

  console.log('Pulizia di eventuali dati di test precedenti...')
  await clean({ dry: false })
  await writePlaceholders(uploads)

  const photo = name => {
    const p = PLACEHOLDERS.find(x => x.name === name)
    return { filename: p.filename, originalName: p.filename, mimetype: 'image/png', size: p.size, type: 'photo', uploadedAt: new Date() }
  }

  // Utenti
  const passwordHash = await bcrypt.hash(PASSWORD, 10)
  const ids = Object.fromEntries(USERS.map(u => [u.key, oid()]))
  const userDocs = USERS.map((u, i) => ({
    _id: ids[u.key],
    email: `${u.username}@${EMAIL_DOMAIN}`,
    passwordHash,
    displayName: u.displayName,
    username: u.username,
    bio: u.bio,
    role: u.role || 'user',
    avatar: `${base}/uploads/${PLACEHOLDERS[i % PLACEHOLDERS.length].filename}`,
    location: { name: u.city[0], lat: u.city[1], lng: u.city[2] },
    defaultVisibility: 'public',
    marketPreferences: { technique: u.technique, categories: ['canne', 'esche'], surveyCompleted: true },
    shop: u.shop ? {
      enabled: true, name: 'Conti Pesca', description: 'Negozio di articoli da pesca a Livorno.',
      verificationStatus: 'verified', verifiedAt: new Date(now - 30 * DAY), sellerType: 'negozio',
      legalName: 'Conti Pesca S.r.l.', vatNumber: '01234567890', city: 'Livorno', delivery: ['ritiro', 'spedizione']
    } : undefined,
    acceptedTermsAt: new Date(now - 90 * DAY), acceptedTermsVersion: 'seed',
    createdAt: new Date(now - (120 - i * 5) * DAY)
  }))
  await insert(User, userDocs)

  // Amicizie: mario-giulia, mario-luca, mario-anna, giulia-luca, marco-anna, marco-paolo accettate;
  // sara->mario e marco->mario in attesa; luca->paolo in attesa. Admin e sara quasi senza amici.
  const F = (a, b, status = 'accepted', ago = 40) => ({ requester: ids[a], recipient: ids[b], status, createdAt: new Date(now - ago * DAY) })
  await insert(Friendship, [
    F('mario', 'giulia'), F('mario', 'luca'), F('mario', 'anna', 'accepted', 25),
    F('giulia', 'luca', 'accepted', 20), F('marco', 'anna', 'accepted', 15), F('marco', 'paolo', 'accepted', 10),
    F('sara', 'mario', 'pending', 2), F('marco', 'mario', 'pending', 1), F('luca', 'paolo', 'pending', 3)
  ])

  // Gruppi
  const grp = { adriatico: oid(), garda: oid(), amici: oid() }
  await insert(Group, [
    { _id: grp.adriatico, name: 'Surfcasting Adriatico', description: 'Uscite e spot lungo la costa adriatica.', owner: ids.giulia, members: [ids.giulia, ids.mario, ids.luca] },
    { _id: grp.garda, name: 'Spinning Garda', description: 'Lucioperca e luccio sul Garda e dintorni.', owner: ids.marco, members: [ids.marco, ids.anna, ids.paolo, ids.luca] },
    { _id: grp.amici, name: 'Amici di Mario', description: 'Gruppo ristretto di test.', owner: ids.mario, members: [ids.mario, ids.giulia] }
  ])

  // Uscite: per ogni utente (tranne admin) una serie nel tempo, con finestre
  // dense negli ultimi 7 e 30 giorni e storico fino a ~14 mesi fa, così le
  // classifiche settimana/mese/anno/sempre hanno risultati diversi.
  const sessions = []
  const photoNames = ['sea', 'lake', 'fish', 'dawn', 'shore']
  const plan = {
    // giorni fa per ogni uscita (le prime due sono in settimana, ecc.)
    mario:  [0, 2, 5, 9, 17, 28, 60, 130, 250, 400],
    marco:  [1, 3, 6, 12, 21, 45, 90, 200, 330],
    giulia: [1, 4, 8, 15, 33, 70, 150, 300],
    luca:   [2, 6, 11, 26, 52, 110, 220],
    anna:   [3, 13, 40, 95, 180],
    paolo:  [5, 19, 80, 260],
    sara:   [10, 55, 360]
  }
  for (const [key, days] of Object.entries(plan)) {
    const user = USERS.find(u => u.key === key)
    days.forEach((ago, idx) => {
      const water = (key === 'marco' || key === 'luca' || key === 'anna' ? rand() < 0.75 : rand() < 0.3) ? 'lago' : 'mare'
      const spot = pick(SPOTS[water])
      const technique = rand() < 0.6 ? user.technique : pick(TECHNIQUES)
      const date = new Date(now - ago * DAY - between(0, 6, 2) * 3600000)
      const nCatches = rand() < 0.15 ? 0 : Math.floor(between(1, 5, 0))
      const catches = Array.from({ length: nCatches }, () => {
        const [species, w, l] = pick(SPECIES[water])
        const [bait, baitType] = pick(BAITS[technique] || BAITS.altro)
        return {
          species, weightKg: between(w[0], w[1], 2), lengthCm: Math.round(between(l[0], l[1], 0)),
          released: rand() < 0.4, time: hhmm(between(5, 20)), baitUsed: bait, baitType,
          notes: rand() < 0.3 ? 'Abboccata decisa, buon combattimento.' : undefined,
          media: rand() < 0.5 ? [{ ...photo('fish'), caption: species }] : []
        }
      })
      // Visibilità: la maggior parte pubblica, qualcuna privata o di gruppo.
      const roll = rand()
      let visibility = roll < 0.7 ? 'users' : roll < 0.85 ? 'private' : 'group'
      let allowedGroups = []
      if (visibility === 'group') {
        const mine = [grp.adriatico, grp.garda, grp.amici].filter(g => ({
          [grp.adriatico]: ['giulia', 'mario', 'luca'], [grp.garda]: ['marco', 'anna', 'paolo', 'luca'], [grp.amici]: ['mario', 'giulia']
        })[g].includes(key))
        if (mine.length) allowedGroups = [pick(mine)]; else visibility = 'private'
      }
      // Garantisce contenuti noti: la prima uscita di ognuno è pubblica con foto.
      if (idx === 0) visibility = 'users'
      const best = catches.reduce((a, b) => (b.weightKg || 0) > (a?.weightKg || 0) ? b : a, null)
      sessions.push({
        _id: oid(), userId: ids[key],
        title: `${technique[0].toUpperCase()}${technique.slice(1)} a ${spot.name}`,
        date, startTime: hhmm(between(5, 17)), endTime: hhmm(between(18, 23)),
        technique, waterType: water, rating: Math.round(between(2, 5, 0)),
        status: 'closed', visibility, allowedGroups, hidden: false,
        location: { name: spot.name, spot: spot.spot, region: spot.region, coords: { lat: spot.lat, lng: spot.lng } },
        sea: water === 'mare'
          ? { seaState: pick(['piatto', 'poco_mosso', 'mosso']), waterTemp: between(12, 25, 0), waterColor: 'verde', tide: { state: pick(['crescente', 'calante', 'alta', 'bassa']) } }
          : { waterLevel: pick(['piena', 'normale', 'magra']), waterTemp: between(8, 24, 0), waterColor: 'torbida' },
        weather: { condition: pick(['sole', 'nuvoloso', 'coperto', 'vento']), windSpeed: between(0, 25, 0), tempAir: between(6, 30, 0), pressure: between(1005, 1025, 0) },
        catches,
        media: idx === 0 || rand() < 0.5 ? [{ ...photo(pick(photoNames)), caption: spot.name }] : [],
        notes: rand() < 0.4 ? 'Uscita di test generata dal seeder.' : undefined,
        totalCatches: catches.length,
        bestCatch: best ? `${best.species} (${best.weightKg}kg)` : undefined,
        createdAt: date
      })
    })
  }
  // Un'uscita nascosta, una in corso e una di gruppo certa, per i casi particolari.
  sessions.push(
    { ...sessions[0], _id: oid(), title: 'Uscita nascosta (test)', hidden: true, date: new Date(now - 4 * DAY) },
    {
      _id: oid(), userId: ids.mario, title: 'Uscita in corso (test)', date: new Date(now - 2 * 3600000), startTime: hhmm(8),
      technique: 'surfcasting', waterType: 'mare', status: 'ongoing', visibility: 'private',
      location: { name: 'Spiaggia di Ostia Lido', spot: 'Pontile di Ostia', region: 'Lazio', coords: { lat: 41.7317, lng: 12.2805 } },
      catches: [{ species: 'Orata', weightKg: 0.9, lengthCm: 33, released: false, time: hhmm(9) }], createdAt: new Date(now - 2 * 3600000)
    },
    {
      _id: oid(), userId: ids.giulia, title: 'Bolentino di gruppo a Ortona', date: new Date(now - 3 * DAY), startTime: '06:00', endTime: '12:00',
      technique: 'bolentino', waterType: 'mare', status: 'closed', visibility: 'group', allowedGroups: [grp.adriatico],
      location: { name: 'Ortona', spot: 'Molo Nord', region: 'Abruzzo', coords: { lat: 42.3558, lng: 14.4072 } },
      catches: [{ species: 'Sarago', weightKg: 0.8, lengthCm: 31, released: false, time: '08:30', media: [photo('fish')] }],
      media: [photo('sea')], totalCatches: 1, bestCatch: 'Sarago (0.8kg)', createdAt: new Date(now - 3 * DAY)
    }
  )
  await insert(Session, sessions)
  const pubSessions = sessions.filter(s => s.visibility === 'users' && !s.hidden)

  // Post e storie del Social
  const P = (author, o) => ({ author: ids[author], visibility: 'public', createdAt: new Date(now - (o.ago ?? 1) * DAY), ...o })
  const sessOf = key => sessions.find(s => String(s.userId) === String(ids[key]) && s.visibility === 'users')
  await insert(Post, [
    P('mario', { ago: 0.2, body: 'Mareggiata finita, domani si va a Ostia con la canna da 4.20. Chi viene?', likes: [ids.giulia, ids.luca], comments: [{ user: ids.giulia, message: 'Io ci sono!' }, { user: ids.luca, message: 'Portami le bibi 😄' }] }),
    P('marco', { ago: 1, title: 'Lucioperca da record', body: 'Lucioperca da 5,8 kg sul Garda, rilasciata dopo la foto.', session: sessOf('marco')?._id, media: [{ ...photo('lake'), caption: 'Lucioperca' }], likes: [ids.anna, ids.paolo, ids.mario], comments: [{ user: ids.anna, message: 'Bestiale!' }] }),
    P('giulia', { ago: 2, body: 'Bolentino in Adriatico: mare piatto, sarago e occhiate.', media: [photo('sea')], likes: [ids.mario] }),
    P('luca', { ago: 3, body: 'Qualcuno sa se il Trasimeno è in magra questa settimana?', comments: [{ user: ids.mario, message: 'Ero lì ieri, livello normale.' }] }),
    P('anna', { ago: 5, title: 'Solo per il gruppo', body: 'Post visibile solo ai membri di Spinning Garda: nuovo spot per il luccio.', visibility: 'group', allowedGroups: [grp.garda], likes: [ids.marco] }),
    P('mario', { ago: 6, body: 'Nota privata: appunti sulle montature che funzionano.', visibility: 'private' }),
    P('paolo', { ago: 4, body: 'In negozio sono arrivati i nuovi minnow! Sconto del 10% per chi mostra Fishlog.', media: [photo('gear')], likes: [ids.marco, ids.luca] }),
    P('giulia', {
      ago: 1.5, type: 'event', title: 'Raduno surfcasting a Rimini', body: 'Serata e notte di pesca sulla spiaggia, cena finale.',
      event: { location: { name: 'Rimini', lat: 44.0693, lng: 12.5953 }, date: new Date(now + 7 * DAY), status: 'open',
        attendees: [{ user: ids.mario, status: 'going', guests: 1 }, { user: ids.luca, status: 'maybe', guests: 0 }, { user: ids.anna, status: 'not_going', guests: 0 }] },
      responses: [{ user: ids.mario, message: 'Porto anche mio cugino.' }]
    }),
    P('marco', { ago: 30, body: 'Un vecchio post di un mese fa per provare lo scorrimento del feed.', likes: [] })
  ])
  const sticker = (s, i) => ({ kind: i % 2 ? 'place' : 'catch', label: i % 2 ? s.location.name : (s.catches[0]?.species || 'Cattura'), subtitle: i % 2 ? s.location.region : `${s.catches[0]?.weightKg ?? ''} kg`.trim(), session: s._id })
  const stories = ['mario', 'marco', 'giulia', 'anna'].map((k, i) => {
    const s = sessOf(k)
    return {
      author: ids[k], media: { ...photo(photoNames[i]), type: 'photo' }, audience: i === 2 ? 'all' : 'friends',
      stickers: s ? [sticker(s, i)] : [], expiresAt: new Date(now + (20 - i * 2) * 3600000),
      views: i === 0 ? [{ user: ids.giulia }, { user: ids.luca }] : [], likes: i === 0 ? [ids.giulia] : [],
      createdAt: new Date(now - (4 + i) * 3600000)
    }
  })
  await insert(Story, stories)

  // Annunci Market (+ visualizzazioni uniche coerenti col contatore)
  const sellers = ['mario', 'marco', 'giulia', 'luca', 'paolo', 'paolo', 'anna', 'sara']
  const visCycle = ['all', 'friends', 'groups']
  const statusCycle = ['active', 'active', 'active', 'reserved', 'active', 'sold', 'active', 'active']
  const viewers = Object.keys(ids)
  const listingDocs = LISTINGS.map(([title, category, condition, price, description], i) => {
    const seller = sellers[i]
    const visibility = visCycle[i % 3]
    const sellerGroups = [grp.adriatico, grp.garda, grp.amici].filter(g => ({
      [grp.adriatico]: ['giulia', 'mario', 'luca'], [grp.garda]: ['marco', 'anna', 'paolo', 'luca'], [grp.amici]: ['mario', 'giulia']
    })[g].includes(seller))
    const shop = seller === 'paolo'
    return {
      _id: oid(), seller: ids[seller], sellerType: shop ? 'negozio' : 'privato', title, description, category, condition, price,
      status: statusCycle[i],
      visibility: visibility === 'groups' && !sellerGroups.length ? 'all' : visibility,
      allowedGroups: visibility === 'groups' ? sellerGroups.slice(0, 1) : [],
      location: { name: USERS.find(u => u.key === seller).city[0], region: '', coords: { lat: USERS.find(u => u.key === seller).city[1], lng: USERS.find(u => u.key === seller).city[2] } },
      media: [{ ...photo(i % 2 ? 'gear' : 'shore'), caption: title }],
      createdAt: new Date(now - (i + 1) * DAY)
    }
  })
  const views = []
  listingDocs.forEach((l, i) => {
    const others = viewers.filter(k => ids[k] !== l.seller).slice(0, 2 + (i * 2) % 6)
    l.views = others.length
    others.forEach(k => views.push({ listing: l._id, user: ids[k], createdAt: new Date(l.createdAt.getTime() + 3600000) }))
  })
  await insert(Listing, listingDocs)
  await insert(ListingView, views)

  // Chat: diretta mario-giulia, diretta mario-luca, gruppo con tre membri
  const mkConv = (o) => ({ _id: oid(), createdAt: new Date(now - 5 * DAY), ...o })
  const c1 = mkConv({ type: 'direct', participants: [ids.mario, ids.giulia], favoritedBy: [ids.mario] })
  const c2 = mkConv({ type: 'direct', participants: [ids.mario, ids.luca] })
  const c3 = mkConv({ type: 'group', name: 'Uscita Trasimeno', owner: ids.luca, participants: [ids.luca, ids.mario, ids.giulia] })
  const M = (conv, from, body, minsAgo, readBy = [], extra = {}) => ({ conversation: conv._id, sender: ids[from], body, type: 'text', readBy: readBy.map(k => ids[k]), createdAt: new Date(now - minsAgo * 60000), ...extra })
  const msgs = [
    M(c1, 'giulia', 'Ciao Mario! Sabato ci sei per il raduno?', 600, ['mario']),
    M(c1, 'mario', 'Certo, porto io le esche.', 590, ['giulia']),
    M(c1, 'giulia', 'Perfetto 🎣', 580, ['mario']),
    M(c1, 'giulia', 'Ti mando la posizione', 45, [], { type: 'location', location: { lat: 44.0693, lng: 12.5953, name: 'Molo di Levante, Rimini' }, body: undefined }),
    M(c2, 'luca', 'Hai visto il livello del Trasimeno?', 300, ['mario']),
    M(c2, 'mario', 'Normale, ieri andava bene.', 280, ['luca']),
    M(c3, 'luca', 'Ho creato il gruppo per domenica al Trasimeno.', 200, ['mario', 'giulia']),
    M(c3, 'giulia', 'Ok, ci sono!', 190, ['luca']),
    M(c3, 'mario', 'Io parto alle 5.', 20, [])
  ]
  const lastOf = c => new Date(Math.max(...msgs.filter(m => m.conversation === c._id).map(m => m.createdAt.getTime())))
  for (const c of [c1, c2, c3]) c.lastMessageAt = lastOf(c)
  await insert(Conversation, [c1, c2, c3])
  await insert(Message, msgs)

  // Notifiche di esempio per Mario
  await insert(Notification, [
    { recipient: ids.mario, type: 'friend_request', actor: ids.sara, data: {}, read: false, createdAt: new Date(now - 2 * DAY) },
    { recipient: ids.mario, type: 'friend_request', actor: ids.marco, data: {}, read: false, createdAt: new Date(now - 1 * DAY) },
    { recipient: ids.mario, type: 'friend_accept', actor: ids.anna, data: {}, read: true, createdAt: new Date(now - 25 * DAY) },
    { recipient: ids.mario, type: 'post_like', actor: ids.giulia, data: {}, read: false, createdAt: new Date(now - 3600000) },
    { recipient: ids.mario, type: 'chat_message', actor: ids.giulia, data: { conversationId: String(c1._id) }, read: false, createdAt: new Date(now - 45 * 60000) }
  ])

  // Riepilogo
  console.log(`\nSeed completato su ${cfg.get('mongodb.url')}`)
  console.log(`  ${userDocs.length} utenti, ${sessions.length} uscite (${pubSessions.length} pubbliche), ${listingDocs.length} annunci, ${views.length} visualizzazioni, 9 post, ${stories.length} storie, 3 chat`)
  console.log(`\nCredenziali (password per tutti: ${PASSWORD})`)
  for (const u of USERS) console.log(`  ${u.displayName.padEnd(15)} ${(u.username + '@' + EMAIL_DOMAIN).padEnd(30)} @${u.username}${u.role ? `  [${u.role}]` : ''}${u.shop ? '  [negozio verificato]' : ''}`)
  console.log('\nNota: le storie scadono dopo ~20 ore (TTL), rilancia `npm run seed` per rigenerarle.')
}

async function main() {
  guard()
  await mongoose.connect(cfg.get('mongodb.url'))
  try {
    if (mode === 'clean') {
      console.log(`${dryRun ? 'Anteprima pulizia' : 'Pulizia'} dati di test su ${cfg.get('mongodb.url')}`)
      await clean({ dry: dryRun })
    } else if (mode === 'seed') {
      await seed()
    } else {
      console.error(`Comando sconosciuto: ${mode} (usa "seed" o "clean")`)
      process.exitCode = 1
    }
  } finally {
    await mongoose.disconnect()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
