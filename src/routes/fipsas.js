import { randomInt, randomUUID } from 'node:crypto'
import { nanoid } from 'nanoid'
import mongoose from 'mongoose'
import FipsasProva from '../models/FipsasProva.js'
import FipsasSettore from '../models/FipsasSettore.js'
import FipsasPesata from '../models/FipsasPesata.js'
import FipsasConcorrente, { chiaveConcorrente } from '../models/FipsasConcorrente.js'
import User from '../models/User.js'
import { loadProva, guard } from '../utils/fipsasAccess.js'
import { classifiche } from '../utils/fipsasStandings.js'
import { buildPdf } from '../utils/fipsasPdf.js'
import { conversione, bonusSuggerito, BONUS_MIN, BONUS_MAX } from '../shared/fipsas/calc.ts'

const bad = (reply, msg, code = 400) => reply.status(code).send({ error: msg })
const str = (v, max = 160) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const num = (v) => (v === '' || v === null || v === undefined ? NaN : Number(v))

// campi dell'intestazione e regole modificabili dall'organizzatore
function leggiProva(body, parziale) {
  const out = {}
  const campi = ['organizzazione', 'manifestazione', 'campoDiGara', 'societaOrganizzatrice', 'direttoreDiGara', 'giudiceDiGara']
  for (const k of campi) if (body[k] !== undefined) out[k] = str(body[k])
  if (body.provaNumero !== undefined) out.provaNumero = Math.floor(num(body.provaNumero))
  if (body.data !== undefined) out.data = new Date(body.data)
  if (body.titoli && typeof body.titoli === 'object') {
    out.titoli = {}
    for (const k of ['settore', 'giornata', 'progressiva', 'squadre']) out.titoli[k] = str(body.titoli[k])
  }
  if (body.regole && typeof body.regole === 'object') {
    const r = body.regole
    const map = { concorrentiPerSettore: [2, 40], componentiPerSquadra: [1, 10], grammiPerPunto: [0.01, 1000], bonusPerCattura: [BONUS_MIN, BONUS_MAX] }
    for (const [k, [lo, hi]] of Object.entries(map)) {
      if (r[k] === undefined) continue
      const n = num(r[k])
      if (!Number.isFinite(n) || n < lo || n > hi) return { error: `Regola «${k}» fuori intervallo (${lo}–${hi})` }
      out[`regole.${k}`] = n
    }
  }
  if (!parziale) {
    if (!out.manifestazione) return { error: 'Manifestazione obbligatoria' }
    if (!Number.isInteger(out.provaNumero) || out.provaNumero < 1) return { error: 'Numero di prova non valido' }
    if (!out.data || Number.isNaN(out.data.getTime())) return { error: 'Data non valida' }
  } else {
    if (out.provaNumero !== undefined && (!Number.isInteger(out.provaNumero) || out.provaNumero < 1)) return { error: 'Numero di prova non valido' }
    if (out.data && Number.isNaN(out.data.getTime())) return { error: 'Data non valida' }
    if (out.manifestazione === '') return { error: 'Manifestazione obbligatoria' }
  }
  return { out }
}

function validaConcorrente(r) {
  const cognome = str(r.cognome, 80)
  if (!cognome) return { error: 'Cognome mancante' }
  const squadra = r.squadra ? String(r.squadra).trim().toUpperCase() : '*'
  if (!['A', 'B', 'C', '*'].includes(squadra)) return { error: `Squadra «${r.squadra}» non valida (A, B, C o *)` }
  return { value: { cognome, nome: str(r.nome, 80), societa: str(r.societa, 120), squadra } }
}

function riepilogoProva(p, ruolo) {
  const o = p.toObject ? p.toObject() : p
  return { ...o, ruolo, judges: undefined, giudici: (o.judges || []).length }
}

export default async function fipsasRoutes(app) {
  const auth = { preHandler: [app.authenticate] }

  // GET /api/fipsas — le mie prove (organizzate o come giudice)
  app.get('/', auth, async (req) => {
    const uid = req.user.sub
    const prove = await FipsasProva.find({ $or: [{ owner: uid }, { judges: uid }] }).sort({ data: -1 }).limit(100).lean()
    return prove.map((p) => ({ ...p, ruolo: String(p.owner) === uid ? 'organizer' : 'judge', judges: undefined, giudici: p.judges.length }))
  })

  // POST /api/fipsas — nuova prova (chi la crea ne è l'organizzatore)
  app.post('/', auth, async (req, reply) => {
    const { out, error } = leggiProva(req.body || {}, false)
    if (error) return bad(reply, error)
    const prova = await FipsasProva.create({ ...expand(out), owner: req.user.sub, serie: req.body.serie ? str(req.body.serie, 40) : nanoid(12) })
    return reply.status(201).send(riepilogoProva(prova, 'organizer'))
  })

  // GET /api/fipsas/:id
  app.get('/:id', auth, async (req, reply) => {
    const r = await loadProva(req.params.id, req.user.sub)
    if (!guard(reply, r)) return
    const giudici = await User.find({ _id: { $in: r.prova.judges } }).select('displayName avatar').lean()
    return { ...riepilogoProva(r.prova, r.isOrganizer ? 'organizer' : 'judge'), isJudge: r.isJudge, giudiciElenco: giudici }
  })

  // PATCH /api/fipsas/:id — intestazione, regole, pubblicazione (organizzatore)
  app.patch('/:id', auth, async (req, reply) => {
    const r = await loadProva(req.params.id, req.user.sub)
    if (!guard(reply, r, 'organizer')) return
    const { out, error } = leggiProva(req.body || {}, true)
    if (error) return bad(reply, error)
    if (out['regole.concorrentiPerSettore'] !== undefined && r.prova.sorteggio?.confirmedAt)
      return bad(reply, 'Dopo il sorteggio la dimensione dei settori non si cambia', 409)
    for (const [k, v] of Object.entries(out)) r.prova.set(k, v)
    if (typeof req.body.isPublic === 'boolean') {
      r.prova.isPublic = req.body.isPublic
      if (r.prova.isPublic && !r.prova.slug) r.prova.slug = nanoid(10)
    }
    if (['bozza', 'in_corso', 'chiusa'].includes(req.body.status)) r.prova.status = req.body.status
    await r.prova.save()
    return riepilogoProva(r.prova, 'organizer')
  })

  // POST /api/fipsas/:id/duplica — prova successiva della stessa serie: stessi concorrenti, nuovo sorteggio
  app.post('/:id/duplica', auth, async (req, reply) => {
    const r = await loadProva(req.params.id, req.user.sub)
    if (!guard(reply, r, 'organizer')) return
    const o = r.prova.toObject()
    const ultima = await FipsasProva.findOne({ serie: o.serie }).sort({ provaNumero: -1 }).lean()
    const copia = await FipsasProva.create({
      owner: o.owner, judges: o.judges, organizzazione: o.organizzazione, manifestazione: o.manifestazione,
      provaNumero: ultima.provaNumero + 1, campoDiGara: o.campoDiGara, data: new Date(), societaOrganizzatrice: o.societaOrganizzatrice,
      direttoreDiGara: o.direttoreDiGara, giudiceDiGara: o.giudiceDiGara, titoli: o.titoli, regole: o.regole, serie: o.serie
    })
    const conc = await FipsasConcorrente.find({ prova: o._id }).lean()
    if (conc.length) {
      await FipsasConcorrente.insertMany(conc.map((c) => ({
        prova: copia._id, cognome: c.cognome, nome: c.nome, societa: c.societa, squadra: c.squadra, user: c.user, chiave: c.chiave
      })))
    }
    return reply.status(201).send(riepilogoProva(copia, 'organizer'))
  })

  // PUT /api/fipsas/:id/giudici — {userIds}
  app.put('/:id/giudici', auth, async (req, reply) => {
    const r = await loadProva(req.params.id, req.user.sub)
    if (!guard(reply, r, 'organizer')) return
    const ids = Array.isArray(req.body?.userIds) ? req.body.userIds.filter((x) => mongoose.isValidObjectId(x)) : null
    if (!ids || ids.length > 10) return bad(reply, 'Elenco giudici non valido')
    const esistenti = await User.countDocuments({ _id: { $in: ids } })
    if (esistenti !== new Set(ids).size) return bad(reply, 'Utente non trovato')
    r.prova.judges = [...new Set(ids)]
    await r.prova.save()
    return { ok: true, giudici: r.prova.judges.length }
  })

  // ── iscritti ──────────────────────────────────────────────────────────────
  app.get('/:id/concorrenti', auth, async (req, reply) => {
    const r = await loadProva(req.params.id, req.user.sub)
    if (!guard(reply, r)) return
    const list = await FipsasConcorrente.find({ prova: r.prova._id }).sort({ numeroGara: 1, cognome: 1 }).lean()
    const nComp = r.prova.regole.componentiPerSquadra
    const squadre = new Map()
    for (const c of list) if (c.squadra !== '*') {
      const k = `${c.societa}|${c.squadra}`; squadre.set(k, (squadre.get(k) || 0) + 1)
    }
    const incomplete = [...squadre.entries()].filter(([, n]) => n < nComp).map(([k, n]) => {
      const [societa, squadra] = k.split('|'); return { societa, squadra, componenti: n, richiesti: nComp }
    })
    return {
      concorrenti: list, squadreCompleteN: [...squadre.values()].filter((n) => n >= nComp).length,
      societa: new Set(list.map((c) => c.societa)).size, senzaSquadra: list.filter((c) => c.squadra === '*').length, squadreIncomplete: incomplete
    }
  })

  app.post('/:id/concorrenti', auth, async (req, reply) => {
    const r = await loadProva(req.params.id, req.user.sub)
    if (!guard(reply, r, 'organizer')) return
    if (r.prova.sorteggio?.confirmedAt) return bad(reply, 'Sorteggio già confermato: rifallo per aggiungere concorrenti', 409)
    const v = validaConcorrente(req.body || {})
    if (v.error) return bad(reply, v.error)
    try {
      const c = await FipsasConcorrente.create({ ...v.value, prova: r.prova._id, chiave: chiaveConcorrente(v.value) })
      return reply.status(201).send(c)
    } catch (e) {
      if (e.code === 11000) return bad(reply, 'Concorrente già iscritto', 409)
      throw e
    }
  })

  app.patch('/:id/concorrenti/:cid', auth, async (req, reply) => {
    const r = await loadProva(req.params.id, req.user.sub)
    if (!guard(reply, r, 'organizer')) return
    if (!mongoose.isValidObjectId(req.params.cid)) return bad(reply, 'Concorrente non trovato', 404)
    const c = await FipsasConcorrente.findOne({ _id: req.params.cid, prova: r.prova._id })
    if (!c) return bad(reply, 'Concorrente non trovato', 404)
    const b = req.body || {}
    if (b.stato !== undefined) {
      if (!['presente', 'assente', 'retrocesso', 'escluso'].includes(b.stato)) return bad(reply, 'Stato non valido')
      c.stato = b.stato
    }
    if (b.penalizzazione !== undefined) {
      const n = num(b.penalizzazione)
      if (!Number.isFinite(n) || n < 0 || n > 100) return bad(reply, 'Penalizzazione non valida')
      c.penalizzazione = n
    }
    if (['cognome', 'nome', 'societa', 'squadra'].some((k) => b[k] !== undefined)) {
      if (r.prova.sorteggio?.confirmedAt) return bad(reply, 'Dati anagrafici bloccati dopo il sorteggio', 409)
      const v = validaConcorrente({ cognome: b.cognome ?? c.cognome, nome: b.nome ?? c.nome, societa: b.societa ?? c.societa, squadra: b.squadra ?? c.squadra })
      if (v.error) return bad(reply, v.error)
      Object.assign(c, v.value, { chiave: chiaveConcorrente(v.value) })
    }
    await c.save()
    return c
  })

  app.delete('/:id/concorrenti/:cid', auth, async (req, reply) => {
    const r = await loadProva(req.params.id, req.user.sub)
    if (!guard(reply, r, 'organizer')) return
    if (r.prova.sorteggio?.confirmedAt) return bad(reply, 'Sorteggio già confermato', 409)
    if (!mongoose.isValidObjectId(req.params.cid)) return bad(reply, 'Concorrente non trovato', 404)
    await FipsasConcorrente.deleteOne({ _id: req.params.cid, prova: r.prova._id })
    return { ok: true }
  })

  // POST /api/fipsas/:id/concorrenti/import — righe lette dal CSV nel client; con dryRun solo anteprima
  app.post('/:id/concorrenti/import', auth, async (req, reply) => {
    const r = await loadProva(req.params.id, req.user.sub)
    if (!guard(reply, r, 'organizer')) return
    const rows = req.body?.rows
    if (!Array.isArray(rows) || rows.length > 500) return bad(reply, 'Elenco non valido (massimo 500 righe)')
    const esistenti = new Set((await FipsasConcorrente.find({ prova: r.prova._id }).select('chiave').lean()).map((c) => c.chiave))
    const validi = []; const errori = []
    rows.forEach((row, i) => {
      const v = validaConcorrente(row || {})
      if (v.error) return errori.push({ riga: i + 1, errore: v.error })
      const chiave = chiaveConcorrente(v.value)
      if (esistenti.has(chiave)) return errori.push({ riga: i + 1, errore: 'Duplicato' })
      esistenti.add(chiave)
      validi.push({ ...v.value, chiave })
    })
    if (req.body.dryRun) return { validi: validi.length, errori, anteprima: validi.slice(0, 20) }
    if (r.prova.sorteggio?.confirmedAt) return bad(reply, 'Sorteggio già confermato', 409)
    if (validi.length) await FipsasConcorrente.insertMany(validi.map((v) => ({ ...v, prova: r.prova._id })))
    return { importati: validi.length, errori }
  })

  // ── sorteggio ─────────────────────────────────────────────────────────────
  // Assegna numeri di gara e settori a caso (crypto). Evita, finché possibile, componenti della stessa squadra nello stesso
  // settore (norme sul sorteggio della Circolare 2026). Dopo la conferma «Rifai» chiede conferma esplicita e non è ammesso con pesate già registrate.
  app.post('/:id/sorteggio', auth, async (req, reply) => {
    const r = await loadProva(req.params.id, req.user.sub)
    if (!guard(reply, r, 'organizer')) return
    const { prova } = r
    const rifai = !!prova.sorteggio?.confirmedAt
    if (rifai && req.body?.conferma !== true) return bad(reply, 'Il sorteggio è già confermato: conferma per rifarlo', 409)
    if (rifai && await FipsasPesata.exists({ prova: prova._id })) return bad(reply, 'Ci sono pesate registrate: il sorteggio non si può rifare', 409)
    const conc = await FipsasConcorrente.find({ prova: prova._id }).lean()
    if (conc.length < 2) return bad(reply, 'Servono almeno 2 concorrenti')
    const cap = prova.regole.concorrentiPerSettore
    const nSettori = Math.ceil(conc.length / cap)

    const mescola = (a) => { const x = [...a]; for (let i = x.length - 1; i > 0; i--) { const j = randomInt(i + 1); [x[i], x[j]] = [x[j], x[i]] } return x }
    const conflitti = (ord) => {
      let n = 0
      for (let s = 0; s < nSettori; s++) {
        const visti = new Set()
        for (const c of ord.slice(s * cap, (s + 1) * cap)) {
          if (c.squadra === '*') continue
          const k = `${c.societa}|${c.squadra}`
          if (visti.has(k)) n++; else visti.add(k)
        }
      }
      return n
    }
    let miglior = null; let min = Infinity
    for (let t = 0; t < 300 && min > 0; t++) {
      const ord = mescola(conc); const n = conflitti(ord)
      if (n < min) { min = n; miglior = ord }
    }
    const ops = miglior.map((c, i) => ({
      updateOne: { filter: { _id: c._id }, update: { $set: { numeroGara: i + 1, settore: String.fromCharCode(65 + Math.floor(i / cap)) } } }
    }))
    await FipsasConcorrente.bulkWrite(ops)
    await FipsasSettore.deleteMany({ prova: prova._id })
    await FipsasSettore.insertMany(Array.from({ length: nSettori }, (_, s) => ({
      prova: prova._id, lettera: String.fromCharCode(65 + s), capacita: Math.min(cap, conc.length - s * cap)
    })))
    prova.sorteggio = { confirmedAt: new Date(), confirmedBy: req.user.sub, redoneCount: (prova.sorteggio?.redoneCount || 0) + (rifai ? 1 : 0) }
    if (prova.status === 'bozza') prova.status = 'in_corso'
    await prova.save()
    const ultimo = conc.length - (nSettori - 1) * cap
    return {
      ok: true, settori: nSettori, conflittiSquadra: min,
      settoreTecnico: ultimo < cap ? { lettera: String.fromCharCode(64 + nSettori), concorrenti: ultimo } : null,
      confermatoAl: prova.sorteggio.confirmedAt
    }
  })

  // ── pesature (solo giudice) ──────────────────────────────────────────────
  app.put('/:id/pesate/:cid', auth, async (req, reply) => {
    const r = await loadProva(req.params.id, req.user.sub)
    if (!guard(reply, r, 'judge')) return
    const { prova } = r
    if (!prova.sorteggio?.confirmedAt) return bad(reply, 'Sorteggio non ancora confermato', 409)
    if (!mongoose.isValidObjectId(req.params.cid)) return bad(reply, 'Concorrente non trovato', 404)
    const c = await FipsasConcorrente.findOne({ _id: req.params.cid, prova: prova._id }).lean()
    if (!c) return bad(reply, 'Concorrente non trovato', 404)
    const sett = await FipsasSettore.findOne({ prova: prova._id, lettera: c.settore }).lean()
    if (sett?.pesaturaChiusaAt) return bad(reply, 'Pesatura del settore chiusa', 409)
    const b = req.body || {}
    const catture = num(b.catture)
    const grammi = num(b.grammi)
    const valide = b.catturaValide === undefined ? catture : num(b.catturaValide)
    if (![catture, grammi, valide].every(Number.isInteger) || catture < 0 || grammi < 0 || valide < 0 || valide > catture || catture > 999)
      return bad(reply, 'Catture e grammi devono essere numeri interi validi (catture valide ≤ catture)')
    if (catture === 0 && grammi > 0) return bad(reply, 'Con 0 catture il peso deve essere 0')
    const sug = bonusSuggerito(valide, prova.regole)
    let bonus = sug
    let manuale = false
    if (b.bonus !== undefined && b.bonus !== null && b.bonus !== '') {
      bonus = num(b.bonus)
      if (!Number.isInteger(bonus) || bonus < 0) return bad(reply, 'Bonus non valido')
      manuale = bonus !== sug
    }
    const clientTime = Number.isFinite(num(b.clientTime)) ? num(b.clientTime) : Date.now()
    const esistente = await FipsasPesata.findOne({ prova: prova._id, concorrente: c._id })
    // idempotenza offline: una scrittura più vecchia di quella già salvata non la sovrascrive
    if (esistente && clientTime < esistente.clientTime) return { ...esistente.toObject(), ignorata: true }
    const dati = {
      catture, catturaValide: valide, grammi, conversione: conversione(grammi, prova.regole), bonus, bonusManuale: manuale,
      enteredBy: req.user.sub, clientId: str(b.clientId, 60) || randomUUID(), clientTime
    }
    const p = await FipsasPesata.findOneAndUpdate(
      { prova: prova._id, concorrente: c._id }, { $set: dati, $setOnInsert: { prova: prova._id, concorrente: c._id } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    )
    return p
  })

  app.delete('/:id/pesate/:cid', auth, async (req, reply) => {
    const r = await loadProva(req.params.id, req.user.sub)
    if (!guard(reply, r, 'judge')) return
    if (!mongoose.isValidObjectId(req.params.cid)) return bad(reply, 'Concorrente non trovato', 404)
    const c = await FipsasConcorrente.findOne({ _id: req.params.cid, prova: r.prova._id }).lean()
    const sett = c && await FipsasSettore.findOne({ prova: r.prova._id, lettera: c.settore }).lean()
    if (sett?.pesaturaChiusaAt) return bad(reply, 'Pesatura del settore chiusa', 409)
    await FipsasPesata.deleteOne({ prova: r.prova._id, concorrente: req.params.cid })
    return { ok: true }
  })

  const chiusura = (chiudi) => async (req, reply) => {
    const r = await loadProva(req.params.id, req.user.sub)
    if (!guard(reply, r, 'judge')) return
    const s = await FipsasSettore.findOne({ prova: r.prova._id, lettera: String(req.params.lettera).toUpperCase() })
    if (!s) return bad(reply, 'Settore non trovato', 404)
    s.pesaturaChiusaAt = chiudi ? new Date() : null
    s.chiusoDa = chiudi ? req.user.sub : undefined
    await s.save()
    return { lettera: s.lettera, chiuso: !!s.pesaturaChiusaAt }
  }
  app.post('/:id/settori/:lettera/chiudi', auth, chiusura(true))
  app.post('/:id/settori/:lettera/riapri', auth, chiusura(false))

  // ── classifiche e PDF ────────────────────────────────────────────────────
  app.get('/:id/classifiche', auth, async (req, reply) => {
    const r = await loadProva(req.params.id, req.user.sub)
    if (!guard(reply, r)) return
    return { aggiornato: new Date().toISOString(), ...(await classifiche(r.prova)) }
  })

  app.get('/:id/pdf', auth, async (req, reply) => {
    const r = await loadProva(req.params.id, req.user.sub)
    if (!guard(reply, r)) return
    const ammessi = ['settori-pieni', 'settore', 'giornata', 'progressiva', 'squadre']
    const docs = String(req.query.docs || ammessi.join(',')).split(',').filter((d) => ammessi.includes(d))
    if (!docs.length) return bad(reply, 'Nessun documento selezionato')
    const cl = await classifiche(r.prova)
    const buf = await buildPdf(r.prova.toObject(), cl, docs, {
      direttore: str(req.query.direttore) || r.prova.direttoreDiGara, giudice: str(req.query.giudice) || r.prova.giudiceDiGara
    })
    return reply.header('Content-Type', 'application/pdf').header('Content-Disposition', 'attachment; filename="classifiche-prova.pdf"').send(buf)
  })
}

// "regole.x" (notazione a punti) → oggetto annidato per Mongoose
function expand(flat) {
  const out = {}
  for (const [k, v] of Object.entries(flat)) {
    if (k.startsWith('regole.')) { out.regole = out.regole || {}; out.regole[k.slice(7)] = v } else out[k] = v
  }
  return out
}
