import mongoose from 'mongoose'

// Una prova di una manifestazione FIPSAS (formato «surf casting»). Più prove con
// la stessa `serie` formano la manifestazione: la progressiva si calcola sulla serie.
// Le intestazioni dei moduli (organizzazione, manifestazione, campo di gara...) sono
// solo testo: il logo della Federazione non è incluso.
const SorteggioSchema = new mongoose.Schema({
  confirmedAt: { type: Date },
  confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  redoneCount: { type: Number, default: 0 }
}, { _id: false })

const FipsasProvaSchema = new mongoose.Schema({
  owner:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  judges:       [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

  // intestazione dei moduli
  organizzazione:      { type: String, trim: true, default: '' },
  manifestazione:      { type: String, trim: true, required: true },
  provaNumero:         { type: Number, required: true, min: 1 },
  campoDiGara:         { type: String, trim: true, default: '' },
  data:                { type: Date, required: true },
  societaOrganizzatrice: { type: String, trim: true, default: '' },
  direttoreDiGara:     { type: String, trim: true, default: '' },
  giudiceDiGara:       { type: String, trim: true, default: '' },
  // alcune classifiche portano un titolo diverso per la stessa prova (es. «Provinciale...» per giornata e squadre)
  titoli: {
    settore:      { type: String, trim: true, default: '' },
    giornata:     { type: String, trim: true, default: '' },
    progressiva:  { type: String, trim: true, default: '' },
    squadre:      { type: String, trim: true, default: '' }
  },

  // regole di punteggio (valori letti nei moduli di esempio; alcune DA CONFERMARE col regolamento)
  regole: {
    concorrentiPerSettore: { type: Number, default: 10, min: 2, max: 40 },
    componentiPerSquadra:  { type: Number, default: 4, min: 1, max: 10 },
    grammiPerPunto:        { type: Number, default: 1, min: 0.01 },
    bonusPerCattura:       { type: Number, default: 50, min: 0 }
  },

  serie:        { type: String, required: true, index: true },
  sorteggio:    { type: SorteggioSchema, default: () => ({}) },
  status:       { type: String, enum: ['bozza', 'in_corso', 'chiusa'], default: 'bozza' },

  isPublic:     { type: Boolean, default: false },
  slug:         { type: String, unique: true, sparse: true }
}, { timestamps: true })

FipsasProvaSchema.index({ owner: 1, data: -1 })
FipsasProvaSchema.index({ judges: 1 })

export default mongoose.model('FipsasProva', FipsasProvaSchema)
