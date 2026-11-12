// Hashtag nel testo dei post: "#" seguito da lettere (anche accentate), cifre o
// underscore. Deve stare a inizio testo o dopo uno spazio/punteggiatura, così
// "https://x.it/a#b" o "a#b" non producono tag. Solo cifre (#1, #2024) non
// contano: sono numeri, non argomenti.
const HASHTAG_RE = /(?<![\p{L}\p{N}_&/#])#([\p{L}\p{N}_]{1,50})/gu
export const MAX_HASHTAGS = 30

export function normalizeTag(tag) {
  return String(tag ?? '').replace(/^#/, '').normalize('NFC').toLocaleLowerCase('it')
}

export function isValidTag(tag) {
  return /^[\p{L}\p{N}_]{1,50}$/u.test(tag) && /\p{L}|_/u.test(tag)
}

// Restituisce i tag unici, minuscoli, nell'ordine di comparsa.
export function extractHashtags(...texts) {
  const out = []
  for (const text of texts) {
    if (!text) continue
    for (const m of String(text).matchAll(HASHTAG_RE)) {
      const tag = normalizeTag(m[1])
      if (isValidTag(tag) && !out.includes(tag)) out.push(tag)
      if (out.length >= MAX_HASHTAGS) return out
    }
  }
  return out
}
