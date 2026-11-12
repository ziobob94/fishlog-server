// Popola/aggiorna il catalogo Species con le specie curate in scripts/data/italianSpecies.js
// (pesci di interesse per la pesca sportiva: mare e acqua dolce) con nome italiano, alias,
// tipo di acqua e descrizione in italiano. IDEMPOTENTE: si può rilanciare su un DB esistente,
// aggiorna i record trovati per nome scientifico (o per gbifKey) senza creare duplicati.
// Le voci già presenti NON perdono immagine né gbifKey. La foto resta on-demand
// (GET /api/species/:key/detail) o si recupera con --images (chiama GBIF, più lento).
//
// Uso: node scripts/seedSpecies.js [--images] [--dry-run]

import AppConfig from '../src/config.js'
import mongoose from 'mongoose'
import Species from '../src/models/Species.js'
import { searchGbif, fetchGbifDetail } from '../src/utils/gbif.js'
import { ITALIAN_SPECIES } from './data/italianSpecies.js'
import { DESCRIPTIONS } from './data/italianSpeciesDescriptions.js'

const WITH_IMAGES = process.argv.includes('--images')
const DRY = process.argv.includes('--dry-run')
const sleep = ms => new Promise(r => setTimeout(r, ms))
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

async function seedOne([scientificName, commonNameIt, aliasesIt, waterType, popular]) {
  const description = DESCRIPTIONS[scientificName]
  const fields = { commonNameIt, aliasesIt: aliasesIt.length ? aliasesIt : undefined, waterType, popular, description }
  Object.keys(fields).forEach(k => fields[k] === undefined && delete fields[k])

  // Cerca un record già esistente (es. importato da GBIF) per nome scientifico: il nome GBIF
  // può avere l'autore in coda ("Sparus aurata Linnaeus, 1758").
  let existing = await Species.findOne({ scientificName: new RegExp('^' + esc(scientificName) + '(\\s|$)', 'i') })

  if (!existing && WITH_IMAGES) {
    const matches = await searchGbif(scientificName)
    const m = matches.find(x => x.scientificName?.startsWith(scientificName))
    if (m) {
      existing = await Species.findOne({ gbifKey: m.gbifKey })
      if (!existing) {
        const detail = await fetchGbifDetail(m.gbifKey)
        fields.gbifKey = m.gbifKey
        fields.imageUrl = detail.imageUrl || undefined
        fields.imageCredit = detail.imageCredit || undefined
        fields.commonNameEn = m.commonNameEn || undefined
        fields.scientificName = m.scientificName
      }
      await sleep(300)
    }
  }

  if (DRY) return existing ? 'update' : 'create'
  if (existing) {
    // Non sovrascrivere un popular già true con false.
    if (existing.popular) fields.popular = true
    await Species.updateOne({ _id: existing._id }, { $set: fields })
    return 'update'
  }
  await Species.create({ scientificName, source: 'manual', ...fields })
  return 'create'
}

async function main() {
  const cfg = new AppConfig()
  await mongoose.connect(cfg.get('mongodb.url'))
  console.log(`MongoDB connesso, seed di ${ITALIAN_SPECIES.length} specie${DRY ? ' (dry-run)' : ''}...`)
  const counts = { create: 0, update: 0, error: 0 }
  for (const row of ITALIAN_SPECIES) {
    try { counts[await seedOne(row)]++ }
    catch (err) { counts.error++; console.error(`[seed] errore su "${row[0]}":`, err.message) }
  }
  console.log(`Seed completato: ${counts.create} create, ${counts.update} aggiornate, ${counts.error} errori.`)
  await mongoose.disconnect()
}

main().catch(err => { console.error(err); process.exit(1) })
