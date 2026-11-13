import FipsasProva from '../models/FipsasProva.js'
import FipsasConcorrente from '../models/FipsasConcorrente.js'
import FipsasSettore from '../models/FipsasSettore.js'
import FipsasPesata from '../models/FipsasPesata.js'
import {
  classificaSettore, classificaGiornata, classificaProgressiva, classificaSquadre, REGOLE_DA_CONFERMARE
} from '../shared/fipsas/calc.ts'

const nome = (c) => ({ cognome: c.cognome, nome: c.nome })

/** Calcola gli esiti di una prova: per ogni concorrente penalità di settore e punteggio. */
async function esitiProva(prova) {
  const [concorrenti, settori, pesate] = await Promise.all([
    FipsasConcorrente.find({ prova: prova._id }).lean(),
    FipsasSettore.find({ prova: prova._id }).lean(),
    FipsasPesata.find({ prova: prova._id }).lean()
  ])
  const pesataDi = new Map(pesate.map((p) => [String(p.concorrente), p]))
  const chiusi = new Set(settori.filter((s) => s.pesaturaChiusaAt).map((s) => s.lettera))
  const maxSettore = Math.max(prova.regole?.concorrentiPerSettore || 10, ...settori.map((s) => s.capacita || 0))

  const perSettore = new Map()
  for (const c of concorrenti) {
    if (!c.settore) continue
    if (!perSettore.has(c.settore)) perSettore.set(c.settore, [])
    perSettore.get(c.settore).push(c)
  }

  const esiti = new Map() // id concorrente -> esito
  const settoriOut = []
  const lettere = [...new Set([...settori.map((s) => s.lettera), ...perSettore.keys()])].sort()
  for (const lettera of lettere) {
    const membri = (perSettore.get(lettera) || []).sort((a, b) => (a.numeroGara || 0) - (b.numeroGara || 0))
    const chiuso = chiusi.has(lettera)
    // senza pesata un concorrente presente non è ancora in classifica, a meno che il settore sia chiuso (allora = cappotto)
    const inGioco = membri.filter((c) => c.stato !== 'presente' || pesataDi.has(String(c._id)) || chiuso)
    const righe = inGioco.map((c) => {
      const p = pesataDi.get(String(c._id))
      return {
        conversione: p?.conversione ?? 0, bonus: p?.bonus ?? 0, catture: p?.catture ?? 0,
        stato: c.stato, penalizzazione: c.penalizzazione || 0
      }
    })
    const ris = classificaSettore(righe, maxSettore)
    const righeOut = membri.map((c) => {
      const p = pesataDi.get(String(c._id))
      const idx = inGioco.indexOf(c)
      const r = idx >= 0 ? ris[idx] : null
      const punteggio = p ? p.conversione + p.bonus : 0
      const out = {
        id: String(c._id), gara: c.numeroGara, ...nome(c), societa: c.societa, squadra: c.squadra, stato: c.stato,
        pesato: !!p, catture: p?.catture ?? 0, catturaValide: p?.catturaValide ?? 0, grammi: p?.grammi ?? 0,
        conversione: p?.conversione ?? 0, bonus: p?.bonus ?? 0, punteggio,
        penalita: r ? r.penalita : null, cappotto: r ? r.cappotto : false
      }
      if (r) esiti.set(String(c._id), { penalita: r.penalitaProgressiva, punteggio, catture: out.catture, penalitaSettore: r.penalita })
      return out
    })
    settoriOut.push({
      lettera, capacita: settori.find((s) => s.lettera === lettera)?.capacita ?? membri.length,
      chiuso, pesati: righeOut.filter((r) => r.pesato).length, totale: membri.length,
      righe: [...righeOut].sort((a, b) => (a.penalita ?? 1e9) - (b.penalita ?? 1e9) || b.punteggio - a.punteggio || (a.gara || 0) - (b.gara || 0))
    })
  }
  return { concorrenti, settoriOut, esiti }
}

const fmtPos = (n) => n

/** Tutte le classifiche della prova (settore, giornata, progressiva individuale, progressiva squadre). */
export async function classifiche(prova) {
  const corr = await esitiProva(prova)
  const { settoriOut, esiti, concorrenti } = corr
  const avvisi = []

  // giornata individuale
  const righeGiornata = []
  for (const s of settoriOut) for (const r of s.righe) {
    if (r.penalita === null || (!r.pesato && r.stato === 'presente' && !s.chiuso)) continue
    righeGiornata.push({ ...r, settore: s.lettera })
  }
  const giornata = classificaGiornata(righeGiornata).map((r, i) => ({ classe: i + 1, ...r }))

  // progressiva: tutte le prove della serie fino a questa
  const serie = await FipsasProva.find({ serie: prova.serie, provaNumero: { $lte: prova.provaNumero } }).sort({ provaNumero: 1 }).lean()
  const perChiave = new Map()
  const proveSerie = []
  for (const p of serie) {
    const e = String(p._id) === String(prova._id) ? corr : await esitiProva(p)
    proveSerie.push({ id: String(p._id), numero: p.provaNumero })
    for (const c of e.concorrenti) {
      const es = e.esiti.get(String(c._id))
      if (!es) continue
      if (!perChiave.has(c.chiave)) perChiave.set(c.chiave, { chiave: c.chiave, ...nome(c), societa: c.societa, squadra: c.squadra, prove: [], provaIds: [] })
      const x = perChiave.get(c.chiave)
      x.prove.push({ penalita: es.penalita, punteggio: es.punteggio, catture: es.catture })
      x.provaIds.push(String(p._id))
    }
  }
  const progressiva = classificaProgressiva([...perChiave.values()]).map((c, i) => ({
    classe: i + 1, cognome: c.cognome, nome: c.nome, societa: c.societa,
    piazzTot: c.prove.reduce((s, p) => s + p.penalita, 0),
    piazzProve: c.prove.map((p) => fmtPos(p.penalita)),
    punteggioTot: c.prove.reduce((s, p) => s + p.punteggio, 0),
    catture: c.prove.reduce((s, p) => s + p.catture, 0)
  }))

  // squadre: composizione dell'ultima prova, risultati su tutta la serie
  const gruppi = new Map()
  for (const c of concorrenti) {
    if (c.squadra === '*') continue
    const k = `${c.societa}|${c.squadra}`
    if (!gruppi.has(k)) gruppi.set(k, { societa: c.societa, squadra: c.squadra, componenti: [] })
    const m = perChiave.get(c.chiave)
    if (m) gruppi.get(k).componenti.push({ prove: m.prove })
  }
  const nComp = prova.regole?.componentiPerSquadra || 4
  const squadre = classificaSquadre(
    [...gruppi.values()].map((g) => ({ ...g, prove: proveSerie })), nComp
  ).map((s, i) => {
    if (s.incompleta) avvisi.push(`Squadra ${s.squadra} · ${s.societa}: ${Math.min(s.componenti.length, nComp)} componenti, ne servono ${nComp}`)
    return {
      classe: i + 1, societa: s.societa, squadra: s.squadra, penalita: s.penTot,
      penaliteProve: s.penProve, peso: s.peso, componenti: s.componenti.length, incompleta: s.incompleta
    }
  })

  const settoriPieni = settoriOut.map((s) => ({ lettera: s.lettera, capacita: s.capacita, totale: s.totale, pieno: s.totale >= s.capacita }))
  return { settori: settoriOut, giornata, progressiva, squadre, settoriPieni, avvisi, regoleDaConfermare: REGOLE_DA_CONFERMARE }
}
