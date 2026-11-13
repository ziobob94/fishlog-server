import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import FipsasProva from '../src/models/FipsasProva.js'
import FipsasConcorrente from '../src/models/FipsasConcorrente.js'
import FipsasSettore from '../src/models/FipsasSettore.js'
import FipsasPesata from '../src/models/FipsasPesata.js'
import { classifiche } from '../src/utils/fipsasStandings.js'
import { buildPdf } from '../src/utils/fipsasPdf.js'

// Senza database: i modelli rispondono con i dati numerici anonimizzati della prova 3 (60 concorrenti, 6 settori).
const fx = JSON.parse(readFileSync(new URL('./fixtures/fipsas-prova3.json', import.meta.url)))
const provaId = 'p3'
const prova = { _id: provaId, serie: 's', provaNumero: 3, regole: { concorrentiPerSettore: 10, componentiPerSquadra: 4 }, data: new Date('2026-09-05'), titoli: {} }
const conc = fx.concorrenti.map((c, i) => ({
  _id: `c${i}`, prova: provaId, cognome: `Cogn${c.gara}`, nome: 'N', societa: c.societa, squadra: c.squadra,
  chiave: `k${c.gara}`, numeroGara: c.gara, settore: c.settore, stato: 'presente'
}))
const pesate = fx.concorrenti.map((c, i) => ({
  prova: provaId, concorrente: `c${i}`, catture: c.catture, catturaValide: c.catture, conversione: c.conversione, bonus: c.bonus, grammi: c.conversione
}))
const settori = [...'ABCDEF'].map((l) => ({ prova: provaId, lettera: l, capacita: 10, pesaturaChiusaAt: new Date() }))

const orig = {}
test.before(() => {
  orig.c = FipsasConcorrente.find; orig.s = FipsasSettore.find; orig.p = FipsasPesata.find; orig.pr = FipsasProva.find
  FipsasConcorrente.find = () => ({ lean: async () => conc })
  FipsasSettore.find = () => ({ lean: async () => settori })
  FipsasPesata.find = () => ({ lean: async () => pesate })
  FipsasProva.find = () => ({ sort: () => ({ lean: async () => [prova] }) })
})
test.after(() => { FipsasConcorrente.find = orig.c; FipsasSettore.find = orig.s; FipsasPesata.find = orig.p; FipsasProva.find = orig.pr })

test('classifiche: settori, giornata e progressiva coerenti con le penalità dei PDF', async () => {
  const cl = await classifiche(prova)
  assert.equal(cl.settori.length, 6)
  for (const s of cl.settori) for (const r of s.righe) {
    const atteso = fx.concorrenti.find((c) => c.gara === r.gara).penalita
    assert.equal(r.penalita, atteso, `settore ${s.lettera} gara ${r.gara}`)
  }
  assert.equal(cl.giornata.length, 60)
  for (let i = 1; i < cl.giornata.length; i++) {
    const a = cl.giornata[i - 1], b = cl.giornata[i]
    assert.ok(a.penalita < b.penalita || (a.penalita === b.penalita && a.punteggio >= b.punteggio))
  }
  assert.equal(cl.progressiva.length, 60)
  assert.equal(cl.progressiva[0].piazzTot, cl.giornata[0].penalita)
  assert.ok(cl.squadre.length > 0)
})

test('PDF: si genera con intestazione e piè di pagina (file %PDF)', async () => {
  const cl = await classifiche(prova)
  const buf = await buildPdf(prova, cl, ['settori-pieni', 'settore', 'giornata', 'progressiva', 'squadre'], { direttore: 'D', giudice: 'G' })
  assert.equal(buf.subarray(0, 4).toString(), '%PDF')
  assert.ok(buf.length > 3000)
})
