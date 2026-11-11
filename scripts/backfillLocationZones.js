// Compila comune/provincia/nazione (e regione se mancante) delle uscite già
// salvate, dalle coordinate, con il geocoding inverso di Nominatim (OSM).
// Rispetta il limite di 1 richiesta al secondo; salta le uscite già compilate
// o senza coordinate, quindi si può rilanciare in sicurezza.
//
// Uso: node scripts/backfillLocationZones.js [--dry]

import AppConfig from '../src/config.js'
const cfg = new AppConfig()

import mongoose from 'mongoose'
import Session from '../src/models/Session.js'

const DRY = process.argv.includes('--dry')
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function reverse(lat, lng) {
  const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=it`,
    { headers: { 'User-Agent': 'fishlog-backfill/1.0' } })
  if (!res.ok) return null
  const a = (await res.json()).address || {}
  return {
    municipality: a.city || a.town || a.village || a.municipality || a.hamlet || '',
    province: (a.county || '').replace(/^(Provincia|Città metropolitana|Libero consorzio comunale) (di|del|della|dell')\s*/i, ''),
    region: a.state || a.county || '',
    country: a.country || ''
  }
}

async function main() {
  await mongoose.connect(cfg.get('mongodb.url'))
  const filter = {
    'location.coords.lat': { $ne: null }, 'location.coords.lng': { $ne: null },
    $or: [{ 'location.country': { $in: [null, ''] } }, { 'location.country': { $exists: false } }]
  }
  const total = await Session.countDocuments(filter)
  console.log(`Uscite da compilare: ${total}${DRY ? ' (dry run)' : ''}`)
  let done = 0
  for await (const s of Session.find(filter).select('location').cursor()) {
    try {
      const z = await reverse(s.location.coords.lat, s.location.coords.lng)
      if (z && z.country) {
        if (!DRY) {
          const set = { 'location.municipality': z.municipality, 'location.province': z.province, 'location.country': z.country }
          if (!s.location.region) set['location.region'] = z.region
          await Session.updateOne({ _id: s._id }, { $set: set })
        }
        done++
      }
    } catch (e) { console.warn(`Uscita ${s._id}: ${e.message}`) }
    await sleep(1100)
  }
  console.log(`Compilate: ${done}/${total}`)
  await mongoose.disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
