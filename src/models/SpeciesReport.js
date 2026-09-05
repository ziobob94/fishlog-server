import mongoose from 'mongoose'

const SpeciesReportSchema = new mongoose.Schema({
  query:  { type: String, required: true },
  note:   { type: String },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  status: { type: String, enum: ['open', 'resolved'], default: 'open' }
}, { timestamps: true })

export default mongoose.model('SpeciesReport', SpeciesReportSchema)
