// iNaturalist indicizza i nomi comuni (anche in italiano) molto meglio di
// GBIF, che copre quasi solo nomi scientifici. Usato come fallback di
// ricerca quando la query non è un nome scientifico.
const FISH_ICONIC_TAXA = new Set(['Actinopterygii', 'Chondrichthyes'])

export async function searchINaturalistFish(q) {
  const params = new URLSearchParams({ q, locale: 'it', rank: 'species', per_page: '20' })

  const res = await fetch(`https://api.inaturalist.org/v1/taxa?${params}`)
  if (!res.ok) return []
  const json = await res.json()

  return (json.results || [])
    // il parametro iconic_taxa non filtra lato server su questo endpoint:
    // filtriamo qui sul campo restituito per escludere organismi non ittici
    .filter(r => r.name && FISH_ICONIC_TAXA.has(r.iconic_taxon_name))
    .slice(0, 10)
    .map(r => {
      // preferred_common_name riflette il locale richiesto solo se esiste
      // un nome italiano; altrimenti iNaturalist può restituire comunque
      // l'inglese. Evitiamo di etichettarlo come italiano in quel caso.
      const isActuallyItalian = r.preferred_common_name && r.preferred_common_name !== r.english_common_name
      return {
        scientificName: r.name,
        commonNameIt: isActuallyItalian ? r.preferred_common_name : null,
        commonNameEn: r.english_common_name || null,
        imageUrl: r.default_photo?.medium_url || null
      }
    })
}
