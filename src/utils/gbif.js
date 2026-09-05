// Classi tassonomiche che coprono i pesci (ossei + cartilaginei + agnati),
// usate per filtrare lato client i risultati della ricerca GBIF (che copre
// tutto il regno animale) ed escludere organismi non ittici.
const FISH_CLASSES = new Set(['Actinopterygii', 'Chondrichthyes', 'Myxini', 'Petromyzonti', 'Coelacanthi'])

export async function searchGbif(q) {
  const params = new URLSearchParams({ q, rank: 'SPECIES', status: 'ACCEPTED', limit: '20' })

  const res = await fetch(`https://api.gbif.org/v1/species/search?${params}`)
  if (!res.ok) return []
  const json = await res.json()

  return (json.results || [])
    // nubKey = chiave del taxon nella GBIF Backbone Taxonomy: stabile e
    // valida anche per gli endpoint /descriptions e /media.
    .filter(r => r.nubKey && r.kingdom === 'Animalia' && FISH_CLASSES.has(r.class) && (r.scientificName || r.canonicalName))
    .map(r => ({
      gbifKey: r.nubKey,
      scientificName: r.scientificName || r.canonicalName,
      commonNameEn: r.vernacularName || null,
      source: 'gbif'
    }))
    // più occorrenze di gbifKey uguale (sinonimi in dataset diversi): dedup
    .filter((r, i, arr) => arr.findIndex(x => x.gbifKey === r.gbifKey) === i)
    .slice(0, 10)
}

export async function fetchGbifDetail(gbifKey) {
  const detail = { description: null, imageUrl: null }
  try {
    const [descRes, mediaRes] = await Promise.all([
      fetch(`https://api.gbif.org/v1/species/${gbifKey}/descriptions`),
      fetch(`https://api.gbif.org/v1/species/${gbifKey}/media`)
    ])

    if (descRes.ok) {
      const d = await descRes.json()
      const results = d.results || []
      // Escludiamo i tipi che non sono narrativa leggibile (stati di
      // conservazione, elenchi di esemplari, nomi vernacolari) e privilegiamo
      // l'inglese; tra i candidati teniamo il testo più lungo.
      const EXCLUDED_TYPES = new Set(['conservation', 'materials_examined', 'vernacular_names', 'native range'])
      const candidates = results.filter(x => x.description && !EXCLUDED_TYPES.has(x.type))
      const best =
        candidates.filter(x => x.language === 'eng').sort((a, b) => b.description.length - a.description.length)[0] ||
        candidates.sort((a, b) => b.description.length - a.description.length)[0]
      if (best) detail.description = best.description.replace(/<[^>]*>/g, '').slice(0, 1000)
    }

    if (mediaRes.ok) {
      const m = await mediaRes.json()
      const img = m.results?.find(x => x.type === 'StillImage' && x.identifier)
      if (img) detail.imageUrl = img.identifier
    }
  } catch {
    // GBIF non raggiungibile: si mantiene quanto già in cache
  }
  return detail
}
