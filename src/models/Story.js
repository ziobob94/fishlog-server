import mongoose from 'mongoose'

// Storia effimera: sparisce dopo 24 ore (indice TTL su expiresAt). Gli adesivi
// sono fotografie del dato al momento della pubblicazione (cattura, luogo,
// acqua e meteo), così la storia resta coerente anche se l'uscita cambia.
const StickerSchema = new mongoose.Schema({
  kind:     { type: String, enum: ['catch', 'place', 'water'], required: true },
  label:    { type: String, required: true },
  subtitle: { type: String },
  session:  { type: mongoose.Schema.Types.ObjectId, ref: 'Session' },
  catchId:  { type: mongoose.Schema.Types.ObjectId }
}, { _id: true })

const StorySchema = new mongoose.Schema({
  author:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  media: {
    filename:     String,
    originalName: String,
    mimetype:     String,
    size:         Number,
    type:         { type: String, enum: ['photo', 'video'] }
  },
  stickers: [StickerSchema],
  audience: { type: String, enum: ['all', 'friends'], default: 'friends' },
  expiresAt: { type: Date, required: true },
  views: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    at:   { type: Date, default: Date.now },
    _id:  false
  }],
  likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}, { timestamps: true })

StorySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })
StorySchema.index({ author: 1, createdAt: -1 })

export default mongoose.model('Story', StorySchema)
