import mongoose from 'mongoose'

const SpeciesSchema = new mongoose.Schema({
  gbifKey:        { type: Number, index: true, unique: true, sparse: true },
  scientificName: { type: String, required: true },
  commonNameIt:   { type: String },
  commonNameEn:   { type: String },
  description:    { type: String },
  imageUrl:       { type: String },
  source:         { type: String, enum: ['gbif', 'inaturalist', 'manual'], default: 'gbif' },
  // Specie comuni usate come suggerimento di default quando non c'è
  // storico di catture per una zona (es. prima uscita registrata).
  popular:        { type: Boolean, default: false, index: true }
}, { timestamps: true })

SpeciesSchema.index({ commonNameIt: 'text', commonNameEn: 'text', scientificName: 'text' })

export default mongoose.model('Species', SpeciesSchema)
