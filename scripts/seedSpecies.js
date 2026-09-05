// Popola la cache Species con un set iniziale di pesci comuni (mare e acqua dolce,
// non solo Mediterraneo), risolvendo ogni voce su GBIF per key/descrizione/immagine.
// Il resto del catalogo si arricchisce da solo on-demand via GET /api/species/search.
//
// Uso: node scripts/seedSpecies.js

import AppConfig from '../src/config.js'
const cfg = new AppConfig()

import mongoose from 'mongoose'
import Species from '../src/models/Species.js'
import { searchGbif, fetchGbifDetail } from '../src/utils/gbif.js'

// scientificName -> nome comune italiano (in inglese usiamo quello restituito da GBIF)
const STARTER_SPECIES = {
  'Sparus aurata':          'Orata',
  'Dicentrarchus labrax':   'Spigola',
  'Diplodus sargus':        'Sarago',
  'Umbrina cirrosa':        'Ombrina',
  'Mullus barbatus':        'Triglia',
  'Scomber scombrus':       'Sgombro',
  'Thunnus thynnus':        'Tonno rosso',
  'Xiphias gladius':        'Pesce spada',
  'Seriola dumerili':       'Ricciola',
  'Sarda sarda':            'Palamita',
  'Pomatomus saltatrix':    'Pesce serra',
  'Epinephelus marginatus': 'Cernia bruna',
  'Solea solea':            'Sogliola',
  'Anguilla anguilla':      'Anguilla',
  'Merluccius merluccius':  'Nasello',
  'Gadus morhua':           'Merluzzo',
  'Sander lucioperca':      'Lucioperca',
  'Esox lucius':            'Luccio',
  'Silurus glanis':         'Siluro',
  'Cyprinus carpio':        'Carpa',
  'Salmo trutta':           'Trota fario',
  'Oncorhynchus mykiss':    'Trota iridea',
  'Salmo salar':            'Salmone atlantico',
  'Micropterus salmoides':  'Black bass'
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function seedOne(scientificName, commonNameIt) {
  const matches = await searchGbif(scientificName)
  const match = matches.find(m => m.scientificName?.startsWith(scientificName)) || matches[0]
  if (!match) {
    console.warn(`[seed] nessun risultato GBIF per "${scientificName}"`)
    return
  }

  const existing = await Species.findOne({ gbifKey: match.gbifKey })
  if (existing?.description && existing?.imageUrl) {
    if (!existing.popular) await Species.updateOne({ gbifKey: match.gbifKey }, { $set: { popular: true } })
    console.log(`[seed] già presente: ${scientificName}`)
    return
  }

  const detail = await fetchGbifDetail(match.gbifKey)

  await Species.findOneAndUpdate(
    { gbifKey: match.gbifKey },
    {
      $set: {
        scientificName: match.scientificName,
        commonNameIt,
        commonNameEn: match.commonNameEn || existing?.commonNameEn || null,
        description: detail.description || existing?.description || null,
        imageUrl: detail.imageUrl || existing?.imageUrl || null,
        source: 'gbif',
        popular: true
      }
    },
    { upsert: true }
  )
  console.log(`[seed] ok: ${commonNameIt} (${scientificName}) -> gbifKey ${match.gbifKey}`)
}

async function main() {
  await mongoose.connect(cfg.get('mongodb.url'))
  console.log('MongoDB connesso, avvio seed specie...')

  for (const [scientificName, commonNameIt] of Object.entries(STARTER_SPECIES)) {
    try {
      await seedOne(scientificName, commonNameIt)
    } catch (err) {
      console.error(`[seed] errore su "${scientificName}":`, err.message)
    }
    await sleep(300) // rispetta i rate limit di GBIF
  }

  console.log('Seed completato.')
  await mongoose.disconnect()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
