// Annuncio dettato a Fishy: dati grezzi del modello → bozza valida per POST /api/listings.
// Fishy NON pubblica da solo: restituisce una bozza da confermare (v. routes/assistant.js).
import { CATEGORIES } from '../models/Listing.js'

const str = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : undefined)
export const MAX_PRICE = 1_000_000

// `prior`: bozza incompleta del turno precedente (già normalizzata). I valori nuovi detti ora la completano.
// → { draft, missing: ['title'|'price'|'condition'] }
export function normalizeListing(args = {}, prior = {}) {
  const draft = { ...cleanDraft(prior) }
  const title = str(args.titolo, 120); if (title) draft.title = title
  const description = str(args.descrizione, 2000); if (description) draft.description = description
  if (CATEGORIES.includes(args.categoria)) draft.category = args.categoria
  if (args.condizione === 'nuovo' || args.condizione === 'usato') draft.condition = args.condizione
  const price = args.prezzo
  if (typeof price === 'number' && Number.isFinite(price) && price > 0 && price <= MAX_PRICE) draft.price = Math.round(price * 100) / 100
  const place = str(args.luogo, 120); if (place) draft.location = { name: place }
  if (!draft.category) draft.category = 'altro'
  const missing = []
  if (!draft.title) missing.push('title')
  if (draft.price == null) missing.push('price')
  if (!draft.condition) missing.push('condition')
  return { draft, missing }
}

// La bozza arriva dal client: solo i campi noti, con tipi e lunghezze controllati.
export function cleanDraft(d) {
  if (!d || typeof d !== 'object') return {}
  const out = {}
  const title = str(d.title, 120); if (title) out.title = title
  const description = str(d.description, 2000); if (description) out.description = description
  if (CATEGORIES.includes(d.category)) out.category = d.category
  if (d.condition === 'nuovo' || d.condition === 'usato') out.condition = d.condition
  if (typeof d.price === 'number' && Number.isFinite(d.price) && d.price > 0 && d.price <= MAX_PRICE) out.price = d.price
  const place = str(d.location?.name, 120); if (place) out.location = { name: place }
  return out
}

const QUESTIONS = {
  price: 'Quanto vuoi chiedere?',
  condition: 'È nuovo o usato?',
  title: 'Che cosa vuoi vendere?'
}
export function listingQuestion(missing) {
  return missing.map(m => QUESTIONS[m]).join(' ')
}
