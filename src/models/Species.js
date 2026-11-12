import mongoose from 'mongoose'

const SpeciesSchema = new mongoose.Schema({
  gbifKey:        { type: Number, index: true, unique: true, sparse: true },
  scientificName: { type: String, required: true },
  commonNameIt:   { type: String },
  commonNameEn:   { type: String },
  // Nomi alternativi/regionali in italiano (es. Spigola → Branzino, Ragno): usati dalla ricerca.
  aliasesIt:      { type: [String], default: undefined },
  waterType:      { type: String, enum: ['mare', 'dolce', 'misto'] },
  description:    { type: String },
  imageUrl:       { type: String },   // solo URL esterno: nessuna immagine salvata sul nostro storage
  imageCredit:    { author: String, license: String, sourceUrl: String },
  source:         { type: String, enum: ['gbif', 'inaturalist', 'manual'], default: 'gbif' },
  // Specie comuni usate come suggerimento di default quando non c'è
  // storico di catture per una zona (es. prima uscita registrata).
  // Record di taglia/peso (es. IGFA all-tackle). Compilare SOLO con dati verificabili e fonte citata;
  // se incerto lasciare vuoto. Nessun valore è precaricato dal seed.
  record: {
    weightKg:  { type: Number },
    lengthCm:  { type: Number },
    place:     { type: String },
    year:      { type: Number },
    angler:    { type: String },
    source:    { type: String },   // es. 'IGFA All-Tackle', con attribuzione
    sourceUrl: { type: String },
    verifiedAt:{ type: Date }
  },
  popular:        { type: Boolean, default: false, index: true }
}, { timestamps: true })

SpeciesSchema.index({ commonNameIt: 'text', commonNameEn: 'text', scientificName: 'text', aliasesIt: 'text' })

export default mongoose.model('Species', SpeciesSchema)
