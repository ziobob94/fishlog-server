// Calcoli delle classifiche FIPSAS (surf casting), come osservati nelle classifiche di esempio.
// Funzioni pure, senza dipendenze né I/O. QUESTO FILE È CONDIVISO: la stessa copia, identica,
// sta in fishlog-server/src/shared/fipsas/calc.ts e in fishlog-client/src/shared/fipsas/calc.ts.
// Se lo modifichi, aggiorna entrambe le copie (usa solo sintassi TS "cancellabile": niente enum).
//
// Fonti: classifiche di esempio (PDF) e Circolare Normativa Pesca di Superficie 2026 (Ver. 1), art. 10 e 15.8.
// CONFERMATO dalla Circolare: 1 punto per grammo (10.1); bonus preda tra 30 e 100 (15.8); penalità di settore = posto per
//   punteggio, a parità più catture poi media (10.2); assente = max concorrenti del settore + 1, retrocesso = +5, escluso fuori
//   dal settore (10.2); cappotto = media delle penalità non assegnate (10.2); progressiva = somma piazzamenti, poi migliori
//   piazzamenti, punteggio, catture (10.2); squadre = somma dei posti dei componenti, poi migliori piazzamenti, punteggio (10.4).
// DA CONFERMARE (REGOLE_DA_CONFERMARE): vedi sotto.

export interface RegoleFipsas {
  /** Grammi per ogni punto. CONFERMATO (10.1): 1 punto per grammo. Ma nelle selettive provinciali conta la tabella cm→punti. */
  grammiPerPunto: number
  /** Bonus per preda: la Circolare (15.8) ammette 30–100, fissato dal Regolamento Particolare. Nei PDF: 50. */
  bonusPerCattura: number
  /** Componenti che contano per squadra. Verificato: 4. */
  componentiPerSquadra: number
  /** Concorrenti per settore. Verificato: 10. */
  concorrentiPerSettore: number
}

export const BONUS_MIN = 30
export const BONUS_MAX = 100

export const REGOLE_DEFAULT: RegoleFipsas = {
  grammiPerPunto: 1,
  bonusPerCattura: 50,
  componentiPerSquadra: 4,
  concorrentiPerSettore: 10,
}

/** Regole che i PDF non provano: l'interfaccia le segnala e i test le marcano «DA CONFERMARE». */
export const REGOLE_DA_CONFERMARE = [
  'bonus-per-catture-valide',        // la Circolare dà 30–100 per preda, ma non dice quali catture contano (misura minima? cartellino)
  'conversione-da-tabella-cm',       // nelle selettive provinciali la tabella FIPSAS cm→punti è obbligatoria: grammi ≠ cm
  'cappotto-con-assenti',            // «compresi gli assenti»: l'assente prende però max+1; il conteggio dei cappotti è ambiguo
  'settore-tecnico',                 // sotto i 10 la classifica va compilata su 10 prendendo atleti dal settore precedente
  'riserve-di-squadra',              // la Circolare dà squadre da 3 a 5, non dice chi conta oltre il limite
  'scarti-nelle-selettive',          // lo scarto è previsto solo «dove indicato»: da verificare nel Regolamento Particolare
  'spareggio-squadre-per-prova',     // «migliore o migliori piazzamenti» delle squadre: interpretato sulle penalità di prova
] as const

export interface RigaPunteggio {
  conversione: number
  bonus: number
  catture: number
  punteggio?: number
}

export interface ProvaConcorrente {
  penalita: number
  punteggio: number
  catture?: number
}

export interface ConcorrenteProgressiva {
  prove: ProvaConcorrente[]
}

/** Posti con media sugli ex aequo. valori: number[]; desc=true → il valore più alto è il 1º posto. */
export function rankAvg(valori: number[], desc = true): number[] {
  const idx = valori.map((_, i) => i).sort((a, b) => (desc ? valori[b] - valori[a] : valori[a] - valori[b]))
  const out: number[] = new Array(valori.length)
  let i = 0
  while (i < idx.length) {
    let j = i
    while (j + 1 < idx.length && valori[idx[j + 1]] === valori[idx[i]]) j++
    const posto = (i + 1 + (j + 1)) / 2
    for (let k = i; k <= j; k++) out[idx[k]] = posto
    i = j + 1
  }
  return out
}

/** Conversione del peso in punti (DA CONFERMARE: grammiPerPunto = 1). */
export const conversione = (grammi: number, r: Pick<RegoleFipsas, 'grammiPerPunto'> = REGOLE_DEFAULT): number =>
  Math.floor(grammi / r.grammiPerPunto)

/** Bonus suggerito = catture valide × bonus per cattura (DA CONFERMARE). */
export const bonusSuggerito = (
  catturaValide: number,
  r: Pick<RegoleFipsas, 'bonusPerCattura'> = REGOLE_DEFAULT,
): number => catturaValide * r.bonusPerCattura

/** Punteggio effettivo = conversione del peso + bonus. */
export const punteggio = (c: { conversione: number; bonus: number }): number => c.conversione + c.bonus

export type StatoConcorrente = 'presente' | 'assente' | 'retrocesso' | 'escluso'

export interface RigaSettore extends RigaPunteggio {
  stato?: StatoConcorrente
  /** Punti di penalità aggiunti alla posizione, senza cambiare gli altri (Circolare 10.2). */
  penalizzazione?: number
}

export interface EsitoSettore {
  /** Penalità nel settore; null per gli esclusi (non classificati nel settore). */
  penalita: number | null
  /** Valore da usare nelle progressive: per gli esclusi = valore dei retrocessi. */
  penalitaProgressiva: number
  cappotto: boolean
}

/**
 * Classifica di settore (Circolare 2026, art. 10.2).
 * - ordine: punteggio effettivo decrescente; a parità più catture; ancora pari = media delle penalità
 * - assente: max concorrenti del settore + 1; retrocesso: + 5 (gli altri avanzano); escluso: non classificato
 * - cappotto: media delle penalità non assegnate (DA CONFERMARE come contare gli assenti)
 * `maxSettore` = numero massimo di concorrenti ammessi in un settore (il settore più grande).
 */
export function classificaSettore(righe: RigaSettore[], maxSettore = REGOLE_DEFAULT.concorrentiPerSettore): EsitoSettore[] {
  const stato = (r: RigaSettore): StatoConcorrente => r.stato ?? 'presente'
  const idxConPesce = righe.map((_, i) => i).filter((i) => stato(righe[i]) === 'presente' && righe[i].catture > 0)
  const idxCappotto = righe.map((_, i) => i).filter((i) => stato(righe[i]) === 'presente' && righe[i].catture === 0)
  const pt = (i: number) => righe[i].punteggio ?? punteggio(righe[i])
  const ordine = [...idxConPesce].sort((a, b) => pt(b) - pt(a) || righe[b].catture - righe[a].catture)
  const penPesce = new Map<number, number>()
  let i = 0
  while (i < ordine.length) {
    let j = i
    while (j + 1 < ordine.length && pt(ordine[j + 1]) === pt(ordine[i]) && righe[ordine[j + 1]].catture === righe[ordine[i]].catture) j++
    const media = (i + 1 + (j + 1)) / 2
    for (let k = i; k <= j; k++) penPesce.set(ordine[k], media)
    i = j + 1
  }
  const nPesce = idxConPesce.length
  const nCapp = idxCappotto.length
  // somma delle posizioni non assegnate / numero dei cappotti
  const penCapp = nCapp > 0 ? (((nPesce + 1) + (nPesce + nCapp)) / 2) : 0
  return righe.map((r, idx) => {
    const extra = r.penalizzazione ?? 0
    const st = stato(r)
    if (st === 'assente') return { penalita: maxSettore + 1 + extra, penalitaProgressiva: maxSettore + 1 + extra, cappotto: false }
    if (st === 'retrocesso') return { penalita: maxSettore + 5 + extra, penalitaProgressiva: maxSettore + 5 + extra, cappotto: false }
    if (st === 'escluso') return { penalita: null, penalitaProgressiva: maxSettore + 5, cappotto: false }
    const base = r.catture > 0 ? (penPesce.get(idx) as number) : penCapp
    return { penalita: base + extra, penalitaProgressiva: base + extra, cappotto: r.catture === 0 }
  })
}

/** Compatibilità: penalità di settore per i soli concorrenti presenti. */
export const penalitaSettore = (righe: RigaSettore[], maxSettore?: number): number[] =>
  classificaSettore(righe, maxSettore ?? righe.length).map((e) => e.penalitaProgressiva)

/** Classifica di giornata: penalità crescente, poi punteggio decrescente. */
export const classificaGiornata = <T extends { penalita: number; punteggio: number }>(righe: T[]): T[] =>
  [...righe].sort((a, b) => a.penalita - b.penalita || b.punteggio - a.punteggio)

/** Prove contate: se `scarti` > 0 si toglie la peggiore penalità (a parità l'ultima), con tutti i dati legati a quella prova.
 *  DA CONFERMARE: lo scarto c'è solo dove lo prevede il Regolamento Particolare; chi è retrocesso/escluso non può scartare. */
export function proveContate<P extends ProvaConcorrente>(prove: P[], scarti = 0, nonScartabile = false): P[] {
  if (scarti <= 0 || nonScartabile || prove.length <= scarti) return prove
  const idx = prove.map((_, i) => i).sort((x, y) => prove[y].penalita - prove[x].penalita || y - x)
  const via = new Set(idx.slice(0, scarti))
  return prove.filter((_, i) => !via.has(i))
}

export interface OpzioniProgressiva { scarti?: number }

const chiaviProgressiva = (prove: ProvaConcorrente[]) => ({
  tot: prove.reduce((s, x) => s + x.penalita, 0),
  ord: prove.map((x) => x.penalita).sort((a, b) => a - b),
  pt: prove.reduce((s, x) => s + x.punteggio, 0),
  catture: prove.reduce((s, x) => s + (x.catture ?? 0), 0),
})

/** Progressiva individuale (Circolare 10.2): minor somma dei piazzamenti; a parità i migliori piazzamenti, poi il maggior
 *  punteggio effettivo, poi il maggior numero di prede. Ancora pari: restano ex aequo (la media delle penalità non conteggiate
 *  si applica nella posizione di stampa). */
export function classificaProgressiva<T extends ConcorrenteProgressiva & { nonScartabile?: boolean }>(
  concorrenti: T[],
  opz: OpzioniProgressiva = {},
): T[] {
  const k = (c: T) => chiaviProgressiva(proveContate(c.prove, opz.scarti ?? 0, c.nonScartabile))
  return [...concorrenti].sort((a, b) => {
    const A = k(a)
    const B = k(b)
    if (A.tot !== B.tot) return A.tot - B.tot
    for (let i = 0; i < Math.min(A.ord.length, B.ord.length); i++) if (A.ord[i] !== B.ord[i]) return A.ord[i] - B.ord[i]
    if (A.pt !== B.pt) return B.pt - A.pt
    return B.catture - A.catture
  })
}

export interface SquadraInput<M extends ConcorrenteProgressiva = ConcorrenteProgressiva> {
  componenti: M[]
  prove: unknown[]
}

export interface SquadraRiga<M extends ConcorrenteProgressiva = ConcorrenteProgressiva> extends SquadraInput<M> {
  penProve: number[]
  penTot: number
  peso: number
  catture: number
  /** Componenti oltre il limite (riserve): non contano. DA CONFERMARE come si designano. */
  riserve: number
  /** Componenti che contano meno del richiesto: squadra incompleta. */
  incompleta: boolean
}

/** Progressiva a squadre: penalità di prova = somma dei posti di settore dei componenti (4, le riserve non contano). */
export function classificaSquadre<M extends ConcorrenteProgressiva, S extends SquadraInput<M>>(
  squadre: S[],
  componentiPerSquadra = REGOLE_DEFAULT.componentiPerSquadra,
): Array<S & Pick<SquadraRiga<M>, 'penProve' | 'penTot' | 'peso' | 'catture' | 'riserve' | 'incompleta'>> {
  const righe = squadre.map((s) => {
    const membri = s.componenti.slice(0, componentiPerSquadra)
    const penProve = s.prove.map((_, k) => membri.reduce((t, m) => t + (m.prove[k]?.penalita ?? 0), 0))
    const peso = membri.reduce((t, m) => t + m.prove.reduce((x, p) => x + p.punteggio, 0), 0)
    const catture = membri.reduce((t, m) => t + m.prove.reduce((x, p) => x + (p.catture ?? 0), 0), 0)
    return {
      catture,
      ...s,
      penProve,
      penTot: penProve.reduce((a, b) => a + b, 0),
      peso,
      riserve: Math.max(0, s.componenti.length - componentiPerSquadra),
      incompleta: membri.length < componentiPerSquadra,
    }
  })
  // Circolare 10.4: minor somma dei posti; a parità i migliori piazzamenti (DA CONFERMARE: sulle penalità di prova),
  // poi il maggior punteggio effettivo dei componenti, poi il maggior numero di prede.
  const ord = (r: { penProve: number[] }) => [...r.penProve].sort((x, y) => x - y)
  return righe.sort((a, b) => {
    if (a.penTot !== b.penTot) return a.penTot - b.penTot
    const A = ord(a)
    const B = ord(b)
    for (let i = 0; i < Math.min(A.length, B.length); i++) if (A[i] !== B[i]) return A[i] - B[i]
    return b.peso - a.peso || b.catture - a.catture
  })
}

/** Testo dei piazzamenti per prova, come nei moduli: «1 - 2 - 11». I decimali restano (es. 4,5). */
export const formatPiazzamenti = (pen: number[]): string => pen.map((p) => String(p).replace('.', ',')).join(' - ')
