import mongoose from 'mongoose'

const ResponseSchema = new mongoose.Schema({
  user:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  message: { type: String, required: true, trim: true }
}, { timestamps: true })

const EventSchema = new mongoose.Schema({
  location: { name: String, lat: Number, lng: Number },
  date:     Date,
  status:   { type: String, enum: ['open', 'closed'], default: 'open' }
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
  responses: [ResponseSchema]
}, { timestamps: true })

PostSchema.index({ visibility: 1, createdAt: -1 })
PostSchema.index({ allowedGroups: 1 })
PostSchema.index({ author: 1 })

export default mongoose.model('Post', PostSchema)
