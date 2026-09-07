import mongoose from 'mongoose'

const MediaSchema = new mongoose.Schema({
  filename:     { type: String, required: true },
  originalName: { type: String },
  mimetype:     { type: String },
  size:         { type: Number },
  type:         { type: String, enum: ['photo', 'video'] },
  caption:      { type: String },
  uploadedAt:   { type: Date, default: Date.now }
})

const LocationSchema = new mongoose.Schema({
  name:   { type: String },
  region: { type: String },
  coords: {
    lat: { type: Number },
    lng: { type: Number }
  }
}, { _id: false })

const CATEGORIES = ['canne', 'mulinelli', 'esche', 'ami_terminali', 'abbigliamento', 'accessori', 'imbarcazioni', 'altro']

const ListingSchema = new mongoose.Schema({
  seller:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // Congelato alla creazione: se l'utente disattiva la modalità negozio in
  // seguito, gli annunci già pubblicati restano etichettati come erano.
  sellerType: { type: String, enum: ['privato', 'negozio'], default: 'privato' },

  title:       { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  category:    { type: String, enum: CATEGORIES, default: 'altro' },
  condition:   { type: String, enum: ['nuovo', 'usato'], required: true },

  price:    { type: Number, required: true, min: 0 },
  currency: { type: String, default: 'EUR' },

  location: LocationSchema,

  status: { type: String, enum: ['active', 'reserved', 'sold', 'deleted'], default: 'active' },
  views:  { type: Number, default: 0 },

  media: [MediaSchema]
}, { timestamps: true })

ListingSchema.index({ status: 1, createdAt: -1 })
ListingSchema.index({ category: 1 })
ListingSchema.index({ seller: 1 })
ListingSchema.index({ title: 'text', description: 'text' })

export { CATEGORIES }
export default mongoose.model('Listing', ListingSchema)
