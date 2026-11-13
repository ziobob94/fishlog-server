import mongoose from 'mongoose'

// Pesata di un concorrente (una per concorrente e prova). Scrive solo il giudice.
// `conversione` e `punteggio` sono calcolati dal server con le regole della prova.
const FipsasPesataSchema = new mongoose.Schema({
  prova:        { type: mongoose.Schema.Types.ObjectId, ref: 'FipsasProva', required: true },
  concorrente:  { type: mongoose.Schema.Types.ObjectId, ref: 'FipsasConcorrente', required: true },
  catture:       { type: Number, required: true, min: 0, max: 999 },
  catturaValide: { type: Number, required: true, min: 0, max: 999 },
  grammi:       { type: Number, required: true, min: 0 },
  conversione:  { type: Number, required: true },
  bonus:        { type: Number, required: true, min: 0 },
  // true se il giudice ha scritto il bonus a mano invece del valore calcolato
  bonusManuale: { type: Boolean, default: false },
  enteredBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  // idempotenza offline: l'ultima scrittura per orario del dispositivo vince, una più vecchia è ignorata
  clientId:     { type: String },
  clientTime:   { type: Number, default: 0 }
}, { timestamps: true })

FipsasPesataSchema.index({ prova: 1, concorrente: 1 }, { unique: true })

export default mongoose.model('FipsasPesata', FipsasPesataSchema)
