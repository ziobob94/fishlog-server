import mongoose from 'mongoose'

// Norma di pesca con fonte citata (taglia minima, numero massimo di catture
// al giorno, fermo biologico, specie protetta) — popolata a mano da un
// admin, mai generata o dedotta automaticamente: un dato legale sbagliato
// ha conseguenze reali, quindi ogni voce porta sempre il provvedimento di
// riferimento e un link alla fonte ufficiale, mai testo riassunto senza
// citazione.
const RegulationSchema = new mongoose.Schema({
  // 'species': regola legata a una specie (taglia minima, fermo, specie
  // protetta...). 'general': regola non legata a una specie (es. area
  // marina protetta, limite attrezzi), mostrata per regione indipendentemente
  // dalla cattura.
  scope: { type: String, enum: ['species', 'general'], required: true },

  // Stesso principio del matching di catches.species: testo libero, non un
  // riferimento a Species, confrontato per nome con tutti i nomi noti della
  // specie quando si mostra la scheda.
  speciesName: { type: String, trim: true },

  // Per cosa vale questa regola: "Italia", "UE", una regione, un'area
  // marina protetta... testo libero perché le fonti non sono mai nella
  // stessa forma.
  region: { type: String, required: true, trim: true },

  title: { type: String, required: true, trim: true },

  minSizeCm:      { type: Number, min: 0 },
  maxCatchPerDay: { type: Number, min: 0 },
  closedSeason:   { type: String, trim: true }, // testo libero: "1 maggio - 31 luglio"
  protected:      { type: Boolean, default: false },
  notes:          { type: String, trim: true },

  // Mai senza fonte: è il punto di fiducia principale di questa sezione.
  sourceTitle: { type: String, required: true, trim: true },
  sourceUrl:   { type: String, trim: true }
}, { timestamps: true })

RegulationSchema.index({ scope: 1, speciesName: 1 })
RegulationSchema.index({ region: 1 })

export default mongoose.model('Regulation', RegulationSchema)
