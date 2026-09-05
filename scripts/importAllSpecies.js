// Importa in blocco (solo nomi, no foto/descrizione) TUTTE le specie ittiche
// note su GBIF: percorre ogni ordine tassonomico di pesci ossei, cartilaginei,
// agnati e dipnoi nella GBIF Backbone Taxonomy e pagina i risultati.
//
// Le foto/descrizioni NON vengono scaricate qui: si arricchiscono da sole
// on-demand tramite GET /api/species/:key/detail al primo utilizzo, così
// l'import resta veloce e non spreca chiamate su specie mai cercate.
//
// Uso: node scripts/importAllSpecies.js

import AppConfig from '../src/config.js'
const cfg = new AppConfig()

import mongoose from 'mongoose'
import Species from '../src/models/Species.js'

const GBIF_BACKBONE_DATASET_KEY = 'd7dddbf4-2cf0-4f39-9b2a-bb099caae36c'
const PAGE_SIZE = 100

// Copertura pratica di tutti i pesci: ossei, cartilaginei, agnati (lamprede/missine),
// celacanti e dipnoi. Un ordine mancante o non risolto non blocca l'import:
// resta comunque recuperabile via ricerca live (GET /api/species/search).
const FISH_ORDERS = [
  // Actinopterygii (pesci ossei)
  'Acipenseriformes', 'Amiiformes', 'Anguilliformes', 'Argentiniformes', 'Atheriniformes',
  'Aulopiformes', 'Batrachoidiformes', 'Beloniformes', 'Beryciformes', 'Callionymiformes',
  'Carangiformes', 'Centrarchiformes', 'Characiformes', 'Clupeiformes', 'Cypriniformes',
  'Cyprinodontiformes', 'Elopiformes', 'Esociformes', 'Gadiformes', 'Galaxiiformes',
  'Gasterosteiformes', 'Gobiiformes', 'Gonorynchiformes', 'Gymnotiformes', 'Holocentriformes',
  'Hiodontiformes', 'Istiophoriformes', 'Kurtiformes', 'Labriformes', 'Lampriformes',
  'Lepisosteiformes', 'Lophiiformes', 'Mugiliformes', 'Myctophiformes', 'Notacanthiformes',
  'Osmeriformes', 'Osteoglossiformes', 'Perciformes', 'Percopsiformes', 'Pleuronectiformes',
  'Polypteriformes', 'Polymixiiformes', 'Salmoniformes', 'Saccopharyngiformes', 'Scombriformes',
  'Siluriformes', 'Stomiiformes', 'Stephanoberyciformes', 'Synbranchiformes', 'Syngnathiformes',
  'Tetraodontiformes', 'Uranoscopiformes', 'Zeiformes',
  // Chondrichthyes (squali, razze, chimere)
  'Carcharhiniformes', 'Chimaeriformes', 'Heterodontiformes', 'Hexanchiformes', 'Lamniformes',
  'Myliobatiformes', 'Orectolobiformes', 'Pristiformes', 'Pristiophoriformes', 'Rajiformes',
  'Rhinopristiformes', 'Squaliformes', 'Squatiniformes', 'Torpediniformes',
  // Agnati, celacanti, dipnoi
  'Petromyzontiformes', 'Myxiniformes', 'Coelacanthiformes', 'Ceratodontiformes', 'Lepidosireniformes'
]

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function resolveOrderKey(orderName) {
  const params = new URLSearchParams({
    q: orderName, rank: 'ORDER', status: 'ACCEPTED',
    datasetKey: GBIF_BACKBONE_DATASET_KEY, limit: '5'
  })
  const res = await fetch(`https://api.gbif.org/v1/species/search?${params}`)
  if (!res.ok) return null
  const json = await res.json()
  const match = json.results?.find(r => r.canonicalName === orderName || r.scientificName === orderName)
  return match?.nubKey ?? json.results?.[0]?.nubKey ?? null
}

async function importOrder(orderName) {
  const orderKey = await resolveOrderKey(orderName)
  if (!orderKey) {
    console.warn(`[import] ordine non risolto su GBIF: ${orderName}`)
    return { inserted: 0 }
  }

  let offset = 0
  let total = 0
  let inserted = 0

  while (true) {
    const params = new URLSearchParams({
      highertaxonKey: String(orderKey), rank: 'SPECIES', status: 'ACCEPTED',
      datasetKey: GBIF_BACKBONE_DATASET_KEY, limit: String(PAGE_SIZE), offset: String(offset)
    })
    const res = await fetch(`https://api.gbif.org/v1/species/search?${params}`)
    if (!res.ok) break
    const json = await res.json()
    const results = json.results || []

    const docs = results
      .filter(r => r.nubKey && (r.scientificName || r.canonicalName))
      .map(r => ({
        gbifKey: r.nubKey,
        scientificName: r.canonicalName || r.scientificName,
        commonNameEn: r.vernacularName || null,
        source: 'gbif'
      }))

    if (docs.length) {
      const result = await Species.bulkWrite(docs.map(d => ({
        updateOne: {
          filter: { gbifKey: d.gbifKey },
          update: { $setOnInsert: d },
          upsert: true
        }
      })), { ordered: false })
      inserted += result.upsertedCount || 0
    }

    total = json.count ?? total
    offset += PAGE_SIZE
    if (json.endOfRecords || results.length === 0) break
    await sleep(150) // rate limit gentile verso GBIF
  }

  console.log(`[import] ${orderName}: ${total} specie totali, ${inserted} nuove inserite`)
  return { inserted }
}

async function main() {
  await mongoose.connect(cfg.get('mongodb.url'))
  console.log('MongoDB connesso, avvio import completo specie ittiche da GBIF...')

  let grandTotal = 0
  for (const order of FISH_ORDERS) {
    try {
      const { inserted } = await importOrder(order)
      grandTotal += inserted
    } catch (err) {
      console.error(`[import] errore su ordine "${order}":`, err.message)
    }
  }

  console.log(`Import completato. Nuove specie inserite: ${grandTotal}`)
  await mongoose.disconnect()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
