import mongoose from 'mongoose'
import Session from '../models/Session.js'
import { escapeRegExp } from './regex.js'

export const PAGE_SIZE = 20
export const SORTS = ['weight', 'length', 'species']

// period: "all" (default), "30d" (ultimi 30 giorni) oppure un anno "2025".
// Ritorna null se il valore non è valido.
export function periodRange(period = 'all', now = new Date()) {
  if (period === 'all' || period === '') return {}
  if (period === '30d') return { $gte: new Date(now.getTime() - 30 * 86400000) }
  if (/^\d{4}$/.test(period)) {
    const y = Number(period)
    return { $gte: new Date(Date.UTC(y, 0, 1)), $lt: new Date(Date.UTC(y + 1, 0, 1)) }
  }
  return null
}

const nullsLast = (field) => ({ [field]: -1, date: -1, catchId: 1 })

/**
 * Classifica delle catture di un utente.
 * `visibility` è il filtro già calcolato da visibilityFilter(viewer): così il
 * profilo rispetta la stessa privacy delle uscite (private / users / gruppo).
 */
export async function userCatches({ userId, visibility, sort = 'weight', species = '', period = 'all', page = 1, baseUrl = '' }) {
  const range = periodRange(period)
  const match = { $and: [{ userId: new mongoose.Types.ObjectId(userId) }, visibility] }
  if (range && Object.keys(range).length) match.$and.push({ date: range })

  const speciesRe = species ? new RegExp(`^${escapeRegExp(species.trim())}$`, 'i') : null
  const skip = (page - 1) * PAGE_SIZE

  const listSort = sort === 'length' ? nullsLast('lengthCm') : nullsLast('weightKg')

  const [res] = await Session.aggregate([
    { $match: match },
    { $unwind: '$catches' },
    { $project: {
        _id: 0,
        sessionId: '$_id',
        catchId: '$catches._id',
        species: '$catches.species',
        weightKg: '$catches.weightKg',
        lengthCm: '$catches.lengthCm',
        date: 1,
        location: '$location.name',
        photo: { $first: { $filter: { input: { $ifNull: ['$catches.media', []] }, cond: { $eq: ['$$this.type', 'photo'] } } } }
      }
    },
    { $addFields: { speciesKey: { $toLower: '$species' } } },
    { $facet: {
        totals: [
          { $group: { _id: null, catches: { $sum: 1 }, speciesSet: { $addToSet: '$speciesKey' }, maxWeightKg: { $max: '$weightKg' }, maxLengthCm: { $max: '$lengthCm' } } }
        ],
        record: [
          { $match: { weightKg: { $gt: 0 } } }, { $sort: nullsLast('weightKg') }, { $limit: 1 }
        ],
        speciesList: [
          { $group: {
              _id: '$speciesKey', species: { $first: '$species' }, count: { $sum: 1 },
              recordWeightKg: { $max: '$weightKg' }, recordLengthCm: { $max: '$lengthCm' }
          } },
          { $sort: { count: -1, species: 1 } }
        ],
        items: [
          ...(speciesRe ? [{ $match: { species: speciesRe } }] : []),
          { $sort: listSort },
          { $facet: { rows: [{ $skip: skip }, { $limit: PAGE_SIZE }], total: [{ $count: 'n' }] } }
        ]
      }
    }
  ])

  const t = res.totals[0]
  const withUrl = (c) => ({
    sessionId: c.sessionId, catchId: c.catchId, species: c.species, weightKg: c.weightKg ?? null,
    lengthCm: c.lengthCm ?? null, date: c.date, location: c.location || '',
    photoUrl: c.photo ? `${baseUrl}/uploads/${c.photo.filename}` : null
  })
  const rec = res.record[0]

  const out = {
    totals: {
      catches: t?.catches || 0,
      species: t?.speciesSet.length || 0,
      maxWeightKg: t?.maxWeightKg ?? null,
      maxLengthCm: t?.maxLengthCm ?? null
    },
    record: rec ? withUrl(rec) : null,
    species: res.speciesList.map(s => ({
      species: s.species, count: s.count, recordWeightKg: s.recordWeightKg ?? null, recordLengthCm: s.recordLengthCm ?? null
    })),
    sort, period, page, pageSize: PAGE_SIZE
  }

  if (sort === 'species') {
    out.data = out.species
    out.total = out.species.length
    out.hasMore = false
  } else {
    const inner = res.items[0]
    out.data = inner.rows.map(withUrl)
    out.total = inner.total[0]?.n || 0
    out.hasMore = skip + out.data.length < out.total
  }
  return out
}
