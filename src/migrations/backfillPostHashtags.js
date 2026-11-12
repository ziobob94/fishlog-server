import Post from '../models/Post.js'
import { extractHashtags } from '../utils/hashtags.js'

// I post creati prima degli hashtag non hanno il campo `hashtags`: lo
// ricaviamo da titolo e testo. Idempotente: tocca solo i post dove il campo
// manca, quindi dopo la prima esecuzione non fa più nulla.
export async function backfillPostHashtags(log) {
  const legacy = await Post.find({ hashtags: { $exists: false } }).select('_id title body').lean()
  if (!legacy.length) return

  const ops = legacy.map(p => ({
    updateOne: { filter: { _id: p._id }, update: { $set: { hashtags: extractHashtags(p.title, p.body) } } }
  }))
  await Post.bulkWrite(ops, { timestamps: false })
  log?.info(`Backfill hashtags: ${ops.length} post aggiornati`)
}
