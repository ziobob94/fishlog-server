import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  rankAvg, punteggio, penalitaSettore, classificaSettore, proveContate, BONUS_MIN, BONUS_MAX, classificaGiornata, classificaProgressiva, classificaSquadre,
  conversione, bonusSuggerito, formatPiazzamenti,
} from '../src/shared/fipsas/calc.ts'

const fx = JSON.parse(readFileSync(new URL('./fixtures/fipsas-prova3.json', import.meta.url)))

// ── REGOLE VERIFICATE sui PDF di esempio ──────────────────────────────────

test('punteggio = conversione + bonus (60 righe)', () => {
  for (const c of fx.concorrenti) assert.equal(punteggio(c), c.punteggio, `gara ${c.gara}`)
})

test('penalità di settore = posto per punteggio decrescente (60 righe, 6 settori)', () => {
  for (const s of 'ABCDEF') {
    const rs = fx.concorrenti.filter((c) => c.settore === s)
    const pen = penalitaSettore(rs)
    rs.forEach((c, i) => assert.equal(pen[i], c.penalita, `settore ${s}, gara ${c.gara}`))
  }
})

test('ex aequo: più catture prima, poi media delle penalità (Circolare 10.2, esempio 1500/1200/1200)', () => {
  const pen = penalitaSettore([
    { punteggio: 1500, catture: 5 }, { punteggio: 1200, catture: 4 }, { punteggio: 1200, catture: 4 }, { punteggio: 900, catture: 3 },
  ])
  assert.deepEqual(pen, [1, 2.5, 2.5, 4])
  // stesso punteggio ma più catture: prevale chi ne ha di più, niente media
  assert.deepEqual(penalitaSettore([{ punteggio: 500, catture: 3 }, { punteggio: 500, catture: 5 }]), [2, 1])
  assert.deepEqual(rankAvg([5, 5, 5, 1]), [2, 2, 2, 4])
})

test('cappotto = media delle penalità non assegnate (Circolare 10.2)', () => {
  const base = Array.from({ length: 8 }, (_, i) => ({ punteggio: 1000 - i * 10, catture: 3 }))
  // 8 con pesce + 2 cappotti: restano 9 e 10 → 9,5 ciascuno
  assert.deepEqual(penalitaSettore([...base, { punteggio: 0, catture: 0 }, { punteggio: 0, catture: 0 }]).slice(8), [9.5, 9.5])
  // 9 con pesce + 1 cappotto: resta 10
  assert.equal(penalitaSettore([...base, { punteggio: 5, catture: 1 }, { punteggio: 0, catture: 0 }])[9], 10)
})

test('assente = max settore + 1, retrocesso = +5, escluso non classificato; gli altri avanzano (10.2)', () => {
  const r = classificaSettore([
    { punteggio: 900, catture: 2 },
    { punteggio: 1500, catture: 2, stato: 'retrocesso' },
    { punteggio: 100, catture: 1 },
    { punteggio: 0, catture: 0, stato: 'assente' },
    { punteggio: 2000, catture: 4, stato: 'escluso' },
  ], 10)
  assert.deepEqual(r.map((x) => x.penalita), [1, 15, 2, 11, null])
  assert.equal(r[4].penalitaProgressiva, 15)  // escluso: nelle progressive vale come i retrocessi
})

test('penalizzazione: somma punti senza cambiare gli altri (10.2)', () => {
  const r = classificaSettore([{ punteggio: 900, catture: 2, penalizzazione: 3 }, { punteggio: 100, catture: 1 }])
  assert.deepEqual(r.map((x) => x.penalita), [4, 2])
})

test('classifica di giornata: penalità crescente, poi punteggio decrescente', () => {
  const g = classificaGiornata([{ penalita: 2, punteggio: 900 }, { penalita: 1, punteggio: 100 }, { penalita: 2, punteggio: 950 }])
  assert.deepEqual(g.map((r) => r.punteggio), [100, 950, 900])
})

test('progressiva individuale: somma dei piazzamenti', () => {
  const a = { id: 'a', prove: [{ penalita: 1, punteggio: 10 }, { penalita: 5, punteggio: 10 }] }
  const b = { id: 'b', prove: [{ penalita: 2, punteggio: 10 }, { penalita: 3, punteggio: 10 }] }
  const c = { id: 'c', prove: [{ penalita: 4, punteggio: 10 }, { penalita: 4, punteggio: 10 }] }
  assert.deepEqual(classificaProgressiva([c, a, b]).map((x) => x.id), ['b', 'a', 'c'])
})

test('squadre: penalità di prova = somma dei posti dei 4 componenti; ordine penalità poi peso', () => {
  const m = (pen, pt) => ({ prove: [{ penalita: pen, punteggio: pt }] })
  const s1 = { nome: 'S1', prove: [1], componenti: [m(1, 100), m(2, 100), m(3, 100), m(4, 100)] }
  const s2 = { nome: 'S2', prove: [1], componenti: [m(1, 500), m(2, 500), m(3, 500), m(4, 500)] }
  const s3 = { nome: 'S3', prove: [1], componenti: [m(1, 1), m(2, 1), m(3, 1)] }
  const r = classificaSquadre([s1, s2, s3])
  assert.deepEqual(r.map((x) => x.nome), ['S3', 'S2', 'S1'])   // S3 incompleta: 6 < 10 (l'app la segnala)
  assert.equal(r[1].penTot, 10)
  assert.equal(r[0].incompleta, true)
})

test('formato piazzamenti come nei moduli', () => {
  assert.equal(formatPiazzamenti([1, 4.5, 11]), '1 - 4,5 - 11')
})

// ── CONFERMATE dalla Circolare Normativa Pesca di Superficie 2026 ─────────

test('conversione: 1 punto per grammo (10.1)', () => {
  assert.equal(conversione(461), 461)
})

test('bonus preda tra 30 e 100 (15.8)', () => {
  assert.equal(BONUS_MIN, 30)
  assert.equal(BONUS_MAX, 100)
  assert.equal(bonusSuggerito(11), 550)   // 11 prede valide × 50 (50 è il valore dei PDF di esempio, dentro l'intervallo)
})

test('progressiva: minor somma, poi migliori piazzamenti, poi punteggio, poi catture (10.2)', () => {
  const a = { id: 'a', prove: [{ penalita: 1, punteggio: 10 }, { penalita: 5, punteggio: 10 }] }
  const b = { id: 'b', prove: [{ penalita: 3, punteggio: 99 }, { penalita: 3, punteggio: 99 }] }
  assert.deepEqual(classificaProgressiva([b, a]).map((x) => x.id), ['a', 'b'])          // migliori piazzamenti
  const c = { id: 'c', prove: [{ penalita: 3, punteggio: 10 }, { penalita: 3, punteggio: 10 }] }
  assert.deepEqual(classificaProgressiva([c, b]).map((x) => x.id), ['b', 'c'])          // punteggio effettivo
  const d = { id: 'd', prove: [{ penalita: 3, punteggio: 10, catture: 9 }, { penalita: 3, punteggio: 10, catture: 9 }] }
  const e = { id: 'e', prove: [{ penalita: 3, punteggio: 10, catture: 2 }, { penalita: 3, punteggio: 10, catture: 2 }] }
  assert.deepEqual(classificaProgressiva([e, d]).map((x) => x.id), ['d', 'e'])          // numero di prede
})

test('squadre: spareggio per migliori piazzamenti, poi punteggio (10.4)', () => {
  const m = (pen, pt) => ({ prove: [{ penalita: pen, punteggio: pt }, { penalita: pen, punteggio: pt }] })
  const s1 = { nome: 'S1', prove: [1, 2], componenti: [m(2, 100), m(2, 100)] }
  const s2 = { nome: 'S2', prove: [1, 2], componenti: [m(2, 900), m(2, 900)] }
  assert.deepEqual(classificaSquadre([s1, s2], 4).map((x) => x.nome), ['S2', 'S1'])
})

// ── DA CONFERMARE (la Circolare non è esplicita: i test fissano l'ipotesi attuale) ──

test('DA CONFERMARE · bonus: le 12 righe su 60 con bonus < 50 × catture totali (catture non valide? sotto misura?)', () => {
  const sotto = fx.concorrenti.filter((c) => c.bonus < 50 * c.catture)
  assert.ok(sotto.length > 0)
  for (const c of fx.concorrenti) assert.ok(c.bonus % 50 === 0)
})

test('DA CONFERMARE · squadre con più di 4 componenti: contano i primi 4, le riserve no', () => {
  const m = (pen) => ({ prove: [{ penalita: pen, punteggio: 0 }] })
  const [r] = classificaSquadre([{ prove: [1], componenti: [m(1), m(2), m(3), m(4), m(5)] }])
  assert.equal(r.penTot, 10)
  assert.equal(r.riserve, 1)
})

test('DA CONFERMARE · scarto: toglie la peggiore penalità; chi è retrocesso/escluso non può scartare', () => {
  const p = (x) => ({ penalita: x, punteggio: 0 })
  assert.deepEqual(proveContate([p(1), p(9), p(2)], 1).map((x) => x.penalita), [1, 2])
  assert.deepEqual(proveContate([p(1), p(9), p(2)], 1, true).map((x) => x.penalita), [1, 9, 2])
  assert.equal(proveContate([p(1), p(9)], 0).length, 2)   // senza scarto: nessuno toglie nulla
})

test('DA CONFERMARE · settore tecnico (<10): la Circolare vuole la classifica su 10 atleti, non implementato', { todo: true }, () => {
  assert.fail('non implementato: serve la regola operativa dal Regolamento Particolare')
})
