import mongoose from 'mongoose'

const ResponseSchema = new mongoose.Schema({
  user:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  message: { type: String, required: true, trim: true }
}, { timestamps: true })

// Commento generico, valido su qualunque post (a differenza di "responses",
// che restano solo l'adesione/RSVP sugli eventi).
const CommentSchema = new mongoose.Schema({
  user:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  message: { type: String, required: true, trim: true }
}, { timestamps: true })

// Adesione strutturata a un evento (partecipo/forse/non partecipo + ospiti),
// distinta dai "responses" testuali liberi. Un solo documento per utente:
// viene aggiornato in place se l'utente cambia idea.
const AttendeeSchema = new mongoose.Schema({
  user:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['going', 'maybe', 'not_going'], required: true },
  guests: { type: Number, default: 0, min: 0 }
}, { timestamps: true })

const MediaSchema = new mongoose.Schema({
  filename:     { type: String, required: true },
  originalName: { type: String },
  mimetype:     { type: String },
  size:         { type: Number },
  type:         { type: String, enum: ['photo', 'video'] },
  caption:      { type: String },
  uploadedAt:   { type: Date, default: Date.now }
})

const EventSchema = new mongoose.Schema({
  location:  { name: String, lat: Number, lng: Number },
  date:      Date,
  status:    { type: String, enum: ['open', 'closed'], default: 'open' },
  attendees: [AttendeeSchema]
}, { _id: false })

const PostSchema = new mongoose.Schema({
  author:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type:         { type: String, enum: ['post', 'event'], default: 'post' },
  visibility:   { type: String, enum: ['public', 'group', 'private'], default: 'public' },
  allowedGroups: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Group' }],
  title:        { type: String, trim: true },
  body:         { type: String, required: true, trim: true },
  // default: undefined evita che Mongoose crei comunque il subdocumento
  // (con i suoi default interni, es. status:'open') per i post non-evento.
  event:        { type: EventSchema, default: undefined },
  responses: [ResponseSchema],
  comments:  [CommentSchema],
  likes:     [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  media:     [MediaSchema]
}, { timestamps: true })

PostSchema.index({ visibility: 1, createdAt: -1 })
PostSchema.index({ allowedGroups: 1 })
PostSchema.index({ author: 1 })

export default mongoose.model('Post', PostSchema)
