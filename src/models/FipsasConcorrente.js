import mongoose from 'mongoose'

// Concorrente di una prova. `chiave` (cognome+nome+società normalizzati) lo collega
// alle altre prove della stessa serie, per la progressiva.
const FipsasConcorrenteSchema = new mongoose.Schema({
  prova:     { type: mongoose.Schema.Types.ObjectId, ref: 'FipsasProva', required: true },
  cognome:   { type: String, required: true, trim: true },
  nome:      { type: String, trim: true, default: '' },
  societa:   { type: String, trim: true, default: '' },
  // squadra A–C della società; '*' = senza squadra
  squadra:   { type: String, enum: ['A', 'B', 'C', '*'], default: '*' },
  user:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  chiave:    { type: String, required: true },
  // Circolare 2026 art. 10.2: assente = max settore + 1, retrocesso = +5, escluso = non classificato nel settore
  stato:          { type: String, enum: ['presente', 'assente', 'retrocesso', 'escluso'], default: 'presente' },
  penalizzazione: { type: Number, default: 0, min: 0 },
  // assegnati dal sorteggio
  numeroGara: { type: Number, default: null },
  settore:    { type: String, default: null }
}, { timestamps: true })

FipsasConcorrenteSchema.index({ prova: 1, chiave: 1 }, { unique: true })
FipsasConcorrenteSchema.index({ prova: 1, numeroGara: 1 })

export function chiaveConcorrente({ cognome, nome, societa }) {
  const n = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
  return [n(cognome), n(nome), n(societa)].join('|')
}

export default mongoose.model('FipsasConcorrente', FipsasConcorrenteSchema)
