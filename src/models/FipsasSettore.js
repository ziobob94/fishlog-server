import mongoose from 'mongoose'

// Settore di una prova (A–F, da 10 concorrenti). Esiste solo dopo il sorteggio.
const FipsasSettoreSchema = new mongoose.Schema({
  prova:     { type: mongoose.Schema.Types.ObjectId, ref: 'FipsasProva', required: true },
  lettera:   { type: String, required: true, match: /^[A-Z]$/ },
  capacita:  { type: Number, required: true, min: 1 },
  pesaturaChiusaAt: { type: Date, default: null },
  chiusoDa:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true })

FipsasSettoreSchema.index({ prova: 1, lettera: 1 }, { unique: true })

export default mongoose.model('FipsasSettore', FipsasSettoreSchema)
