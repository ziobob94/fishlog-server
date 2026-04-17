import mongoose from 'mongoose'

const LocationSchema = new mongoose.Schema({
  name:   { type: String, required: true },
  spot:   { type: String },
  region: { type: String },
  coords: {
    lat: { type: Number },
    lng: { type: Number }
  },
  notes: { type: String }
}, { _id: false })

const SeaSchema = new mongoose.Schema({
  seaState:   { type: String, enum: ['piatto', 'poco_mosso', 'mosso', 'molto_mosso', 'agitato', ''] },
  waveHeight: { type: String },
  wavePeriod: { type: String },
  current:    { type: String },
  waterLevel: { type: String, enum: ['piena', 'normale', 'magra', ''] },
  waterColor: { type: String },
  waterTemp:  { type: Number },
  tide: {
    state: { type: String, enum: ['crescente', 'calante', 'alta', 'bassa', ''] },
    notes: { type: String }
  }
}, { _id: false })

const WeatherSchema = new mongoose.Schema({
  condition:     { type: String, enum: ['sole', 'nuvoloso', 'coperto', 'pioggia', 'vento', 'nebbia', ''] },
  windDirection: { type: String },
  windSpeed:     { type: Number },
  tempAir:       { type: Number },
  humidity:      { type: Number },
  pressure:      { type: Number },
  notes:         { type: String }
}, { _id: false })

const BaitSchema = new mongoose.Schema({
  name:         { type: String, required: true },
  type:         { type: String, enum: ['naturale', 'artificiale', 'misto', ''] },
  presentation: { type: String },
  notes:        { type: String }
}, { _id: false })

const RigSchema = new mongoose.Schema({
  name:         { type: String, required: true },
  type:         { type: String },
  hookSize:     { type: String },
  hookType:     { type: String },
  lineMainLb:   { type: Number },
  leaderLb:     { type: Number },
  sinkerWeight: { type: Number },
  sinkerType:   { type: String },
  swivel:       { type: String },
  notes:        { type: String }
}, { _id: false })

const CastSchema = new mongoose.Schema({
  distance:  { type: Number },
  direction: { type: String },
  rig:       { type: String },
  bait:      { type: String },
  result:    { type: String, enum: ['cattura', 'abboccata', 'niente', ''] },
  notes:     { type: String }
}, { _id: false })

const CatchSchema = new mongoose.Schema({
  species:  { type: String, required: true },
  weightKg: { type: Number },
  lengthCm: { type: Number },
  released: { type: Boolean, default: false },
  baitUsed: { type: String },
  rigUsed:  { type: String },
  distance: { type: Number },
  time:     { type: String },
  notes:    { type: String }
}, { _id: false })

const MediaSchema = new mongoose.Schema({
  filename:     { type: String, required: true },
  originalName: { type: String },
  mimetype:     { type: String },
  size:         { type: Number },
  type:         { type: String, enum: ['photo', 'video'] },
  caption:      { type: String },
  uploadedAt:   { type: Date, default: Date.now }
})

const SessionSchema = new mongoose.Schema({
  title:     { type: String },
  date:      { type: Date, required: true, default: Date.now },
  startTime: { type: String },
  endTime:   { type: String },
  technique: { type: String, enum: ['surfcasting', 'feeder', 'spinning', 'bolentino', 'mosca', 'altro', ''] },
  waterType: { type: String, enum: ['mare', 'fiume', 'lago', 'altro', ''], default: '' },
  rating:    { type: Number, min: 0, max: 5, default: 0 },

  location: { type: LocationSchema, required: true },
  sea:      { type: SeaSchema, default: {} },
  weather:  { type: WeatherSchema, default: {} },

  baits:   [BaitSchema],
  rigs:    [RigSchema],
  casts:   [CastSchema],
  catches: [CatchSchema],
  media:   [MediaSchema],

  notes: { type: String },

  // Pronto per auth futura
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  visibility:    { type: String, enum: ['private', 'users', 'group'], default: 'private' },
  allowedGroups: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Group' }],
  hidden:        { type: Boolean, default: false },

  // Campi calcolati (aggiornati nel pre-save)
  totalCatches: { type: Number, default: 0 },
  bestCatch:    { type: String }

}, { timestamps: true })

SessionSchema.index({ date: -1 })
SessionSchema.index({ 'location.name': 1 })
SessionSchema.index({ technique: 1 })
SessionSchema.index({ userId: 1, date: -1 })

SessionSchema.pre('save', function (next) {
  this.totalCatches = this.catches?.length || 0
  if (this.catches?.length) {
    const best = this.catches.reduce((a, b) =>
      (b.weightKg || 0) > (a.weightKg || 0) ? b : a
    )
    this.bestCatch = `${best.species}${best.weightKg ? ` (${best.weightKg}kg)` : ''}`
  }
  next()
})

export default mongoose.model('Session', SessionSchema)
