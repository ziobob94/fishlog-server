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
  const words = String(text || '').toLowerCase().replace(/[.,;:!?()"«»]/g, ' ').split(/\s+/).filter(Boolean)
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
