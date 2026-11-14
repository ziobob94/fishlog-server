// Parser a regole per le catture a voce: ripiego quando il servizio AI è al limite (429), non raggiungibile o non
// configurato. Capisce frasi semplici in italiano ("ho preso una spigola da 2 chili e mezzo, 55 cm, rilasciata,
// alle 14:30, con l'arenicola") e UNA sola cattura per frase. Produce lo stesso formato dello strumento
// `registra_cattura`, quindi passa per le stesse validazioni (specie sul catalogo, misure, ora).
import { resolveSpecies } from './voiceCatch.js'

const WORDS = { un: 1, uno: 1, una: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, nove: 9, dieci: 10 }
const NUM = '(\\d+(?:[.,]\\d+)?|un|uno|una|due|tre|quattro|cinque|sei|sette|otto|nove|dieci)'
const toNum = s => (s in WORDS ? WORDS[s] : parseFloat(String(s).replace(',', '.')))
const STOP = new Set(['ho', 'preso', 'presa', 'pescato', 'pescata', 'catturato', 'catturata', 'appena', 'una', 'uno', 'un', 'il', 'lo', 'la', 'di', 'da', 'con', 'alle', 'circa', 'poi', 'anche', 'kg', 'chili', 'chilo', 'cm', 'grammi', 'rilasciato', 'rilasciata', 'ributtato', 'ributtata', 'tenuto', 'tenuta', 'ora', 'esca', 'peso', 'pesa', 'lungo', 'lunga', 'pesce'])

export function extractFields(text) {
  const t = ` ${String(text || '').toLowerCase().replace(/\s+/g, ' ')} `
  const out = {}
  let m
  // Peso: "2,5 kg", "2 chili e mezzo", "mezzo chilo", "850 grammi"
  if ((m = t.match(new RegExp(`${NUM}\\s*(?:kg|chili|chilo|chilogrammi)\\b(\\s+e\\s+mezzo)?`)))) out.peso_kg = toNum(m[1]) + (m[2] ? 0.5 : 0)
  else if (/\bmezzo\s+(?:chilo|kg)\b/.test(t)) out.peso_kg = 0.5
  else if ((m = t.match(/(\d+(?:[.,]\d+)?)\s*(?:g|gr|grammi)\b/))) out.peso_kg = toNum(m[1]) / 1000
  // Lunghezza
  if ((m = t.match(/(\d+(?:[.,]\d+)?)\s*(?:cm|centimetri)\b/))) out.lunghezza_cm = toNum(m[1])
  // Rilasciato / trattenuto
  if (/\b(rilasciat\w*|ributtat\w*|rimess\w* in acqua|liberat\w*)\b/.test(t)) out.rilasciato = true
  else if (/\b(tenut\w*|trattenut\w*|portat\w* a casa|in frigo)\b/.test(t)) out.rilasciato = false
  // Ora: "alle 14", "alle 14 e 30", "alle 14:30"
  if ((m = t.match(/\balle\s+(\d{1,2})(?:\s*(?::|\.|e)\s*(\d{2}))?\b/))) out.ora = `${m[1].padStart(2, '0')}:${m[2] || '00'}`
  // Esca: "con l'arenicola", "con il minnow", "con un verme"
  if ((m = t.match(/\bcon\s+(?:l'|il |lo |la |un |una |dell'|del )?\s*([a-zàèéìòù']{3,25}(?: [a-zàèéìòù']{3,15})?)(?=\s*(?:,|\.|$|\be\b|\balle\b|\brilasc|\bda\b))/)) && !(m[1].split(' ')[0] in WORDS)) out.esca = m[1].trim()
  return out
}

// Prima sequenza di 1-3 parole (non vuote né numeri/unità) che il catalogo riconosce come specie.
export async function findSpecies(text, opts) {
  const words = String(text || '').toLowerCase().replace(/[.,;:!?()"«»'’]/g, ' ').split(/\s+/).filter(Boolean)
  let queries = 0
  for (let i = 0; i < words.length && queries < 10; i++) {
    for (const len of [3, 2, 1]) {
      const win = words.slice(i, i + len)
      if (win.length < len || /\d/.test(win.join('')) || STOP.has(win[0]) || STOP.has(win[win.length - 1])) continue
      if (len === 1 && win[0].length < 4) continue
      queries++
      const r = await resolveSpecies(win.join(' '), opts)
      if (r.name) return { specie: win.join(' '), resolved: r }
    }
  }
  return null
}

export async function parseWithRules(text, opts) {
  const sp = await findSpecies(text, opts)
  if (!sp) return { raw: [], reply: '', viaRules: true }
  return { raw: [{ specie: sp.specie, ...extractFields(text), confidenza: 'bassa' }], reply: '', viaRules: true, model: 'regole' }
}

// ── Comandi dell'assistente (inizia uscita, cambia esca, fine uscita) ─────────
const cap = s => s.replace(/\b\p{L}/gu, c => c.toUpperCase())
const PLACE = '(?:a|ad|in|al|alla|allo|presso|sul|sulla|da)\\s+([^,.;]+?)(?=\\s*(?:,|\\.|;|$|\\bcon\\b|\\bcanna\\b|\\bsurfcasting\\b|\\bfeeder\\b|\\bspinning\\b|\\bbolentino\\b))'
const START_RES = [
  new RegExp(`\\b(?:inizio|inizia|iniziamo|comincio|comincia|parto|apro|avvio)\\b[^.,;]*?\\b(?:uscita|pescata|sessione)\\b(?:\\s+(?:di pesca|a pesca|di (?:surfcasting|feeder|spinning|bolentino|mosca)))?\\s*${PLACE}`),
  new RegExp(`\\bvado a pescare\\s+${PLACE}`)
]
const END_RE = /\b(?:finisco|finito|chiudo|termino|concludo)\b[^.,;]*\b(?:uscita|pescata|sessione)\b|\bfine (?:uscita|pescata)\b|\bho finito\b/
const BAIT_RES = [
  /\b(?:ora|adesso|da ora) uso\s+(?:l'|il |lo |la |un |una |dei |del )?([a-zàèéìòù0-9' ]{3,30}?)(?=\s*(?:,|\.|;|$|\be\b))/,
  /\bcambio\s+(?:l')?esca\b[^.;]*?(?:\bcon\b|\bin\b|:|,)\s*(?:l'|il |lo |la |un |una |dei |del |dello )?([a-zàèéìòù0-9' ]{3,30}?)(?=\s*(?:,|\.|;|$|\be\b))/
]

const FASCIA_RE = /\b(?:di|del|della|nel)\s+(mattina|mattino|pomeriggio|sera|notte)\b/
const fasciaOf = t => { const f = (t.match(FASCIA_RE) || [])[1]; return f === 'mattino' ? 'mattina' : f }
const TIME = '(?:alle|all\'|verso le|intorno alle|per le)\\s*(\\d{1,2})(?:\\s*(?:[:.h]|e)\\s*(\\d{2}))?'
const START_TIME_RE = new RegExp(`\\b(?:iniziat[ao]|cominciat[ao]|partit[oa]|iniziato|inizio|parto|partito)\\b[^.;]*?${TIME}`)
const START_TIME_RE2 = new RegExp(`\\bora di (?:inizio|partenza)\\b[^.;]*?${TIME}`)
const END_TIME_RE = new RegExp(`\\b(?:finit[ao]|chius[ao]|terminat[ao]|concluso|conclusa)\\b[^.;]*?${TIME}`)
const PLACE_UPD_RES = [
  /\b(?:uscita|pescata|posto|luogo|spot)\s+(?:è|e'|era|sta|si trova)\s+(?:a|ad|in|al|alla|allo|presso|sul|sulla)\s+([^,.;]+?)(?=\s*(?:,|\.|;|$))/,
  /\b(?:cambia|cambio|correggi|modifica|sposta)\s+(?:il\s+)?(?:luogo|posto|spot)\s+(?:in|con|a)\s+([^,.;]+?)(?=\s*(?:,|\.|;|$))/,
  /\bsono\s+(?:a|ad|in|al|alla|allo|presso|sul|sulla)\s+([^,.;]+?)(?=\s*(?:,|\.|;|$))/
]
const clean = s => s.replace(/\s+m'$/, '').trim() // «m'» finale: rumore tipico del riconoscimento vocale

// Riconosce i comandi dell'assistente con regole semplici. Restituisce { calls, reply, viaRules, model } con lo
// stesso formato delle chiamate agli strumenti del modello. `calls` vuoto = non ho capito.
export async function parseAssistantWithRules(text, opts) {
  let t = ` ${String(text || '').toLowerCase().replace(/\s+/g, ' ')} `
  const calls = []
  let m
  for (const re of START_RES) {
    if ((m = t.match(re))) {
      const args = { luogo: cap(m[1].trim()) }
      const tech = t.match(/\b(surfcasting|feeder|spinning|bolentino|mosca)\b/)
      if (tech) args.tecnica = tech[1]
      else if (/\bcanna da fondo\b/.test(t)) { args.tecnica = 'altro'; args.note = 'canna da fondo' }
      calls.push({ name: 'inizia_uscita', args })
      t = t.replace(m[0], ' ')
      break
    }
  }
  for (const re of BAIT_RES) {
    if ((m = t.match(re))) { calls.push({ name: 'cambia_esca', args: { esca: m[1].trim() } }); t = t.replace(m[0], ' '); break }
  }
  // Correzioni dell'uscita in corso (v. modifica_uscita): luogo e orari.
  const upd = {}
  for (const re of PLACE_UPD_RES) {
    if (!calls.length && (m = t.match(re))) { const luogo = clean(m[1]); if (luogo) upd.luogo = cap(luogo); t = t.replace(m[0], ' '); break }
  }
  const startClause = t.match(START_TIME_RE) || t.match(START_TIME_RE2)
  if (!calls.some(c => c.name === 'inizia_uscita') && startClause) {
    upd.ora_inizio = `${startClause[1]}:${startClause[2] || '00'}`
    const f = fasciaOf(startClause[0]) || fasciaOf(t); if (f) upd.fascia_inizio = f
    t = t.replace(startClause[0], ' ')
  }
  const endClause = t.match(END_TIME_RE)
  const endArgs = {}
  if (endClause) {
    endArgs.ora_fine = `${endClause[1]}:${endClause[2] || '00'}`
    const f = fasciaOf(endClause[0]); if (f) endArgs.fascia_fine = f
    t = t.replace(endClause[0], ' ')
  }
  if (Object.keys(upd).length) calls.push({ name: 'modifica_uscita', args: upd })
  const wantsEnd = END_RE.test(t) || !!endClause
  if (wantsEnd) t = t.replace(END_RE, ' ')
  const hit = await parseWithRules(t, opts)
  for (const raw of hit.raw) calls.push({ name: 'registra_cattura', args: raw })
  if (wantsEnd) calls.push({ name: 'fine_uscita', args: endArgs })
  return { calls, raw: calls.filter(c => c.name === 'registra_cattura').map(c => c.args), reply: '', viaRules: true, model: 'regole' }
}
