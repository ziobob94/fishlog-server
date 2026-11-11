import mongoose from 'mongoose'

// Una riga per coppia (annuncio, utente): garantisce una sola visualizzazione
// per utente anche con riaperture ripetute o richieste in parallelo.
const ListingViewSchema = new mongoose.Schema({
  listing: { type: mongoose.Schema.Types.ObjectId, ref: 'Listing', required: true },
  user:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: { createdAt: true, updatedAt: false } })

ListingViewSchema.index({ listing: 1, user: 1 }, { unique: true })

export default mongoose.model('ListingView', ListingViewSchema)
