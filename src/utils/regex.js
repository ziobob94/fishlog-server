// Esegue l'escape dei metacaratteri regex in un input utente prima di usarlo
// in un `new RegExp(...)` per una query Mongo. Senza questo, un utente può
// costruire pattern costosi (ReDoS, es. `(a+)+$`) o alterare la semantica
// del filtro passando `.*` o simili come "search"/"location"/ecc.
export function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
