// Località preferite: validazione della lista intera inviata dal client (PUT) e riassunto compatto del meteo per scheda.
export const MAX_FAVORITE_PLACES = 8

// Ritorna { ok: true, places } con la lista pulita e rinumerata (order 0..n-1 nell'ordine ricevuto), oppure { ok: false, error }.
export function normalizeFavorites(input) {
  if (!Array.isArray(input)) return { ok: false, error: 'Lista non valida' }
  if (input.length > MAX_FAVORITE_PLACES) return { ok: false, error: `Massimo ${MAX_FAVORITE_PLACES} località` }
  const seen = new Set()
  const places = []
  for (const p of input) {
    const id = typeof p?.id === 'string' ? p.id.trim().slice(0, 64) : ''
    const name = typeof p?.name === 'string' ? p.name.trim().slice(0, 80) : ''
    const lat = Number(p?.lat), lon = Number(p?.lon ?? p?.lng)
    if (!id || !name || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return { ok: false, error: 'Località non valida' }
    if (seen.has(id)) return { ok: false, error: 'Località duplicata' }
    seen.add(id)
    places.push({ id, name, lat: Number(lat.toFixed(4)), lon: Number(lon.toFixed(4)), order: places.length })
  }
  return { ok: true, places }
}

// Lista salvata → risposta API, sempre in ordine.
export const sortedFavorites = (list) =>
  [...(list || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map(p => ({ id: p.id, name: p.name, lat: p.lat, lon: p.lon, order: p.order }))

// Vista meteo completa → dati minimi per una scheda. Onda null se il punto non ha mare (località interne).
export function summarizeForCard(view) {
  const c = view?.current || {}
  const m = view?.marine || {}
  return {
    temp: c.temp ?? null, wmo: c.wmo ?? null, condition: c.condition ?? null, isDay: typeof c.isDay === 'boolean' ? c.isDay : null,
    windSpeed: c.windSpeed ?? null, windDeg: c.windDeg ?? null,
    waveHeight: m.available ? (m.waveHeight ?? null) : null, hasSea: !!m.available,
    updatedAt: view?.updatedAt ?? null,
  }
}
