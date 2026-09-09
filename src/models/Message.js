import mongoose from 'mongoose'

const MessageSchema = new mongoose.Schema({
  conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true },
  sender:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // Obbligatorio solo per type 'text' (validato a livello di route, non qui,
  // perché il vincolo dipende da un altro campo dello stesso documento).
  body:         { type: String, trim: true },
  type:         { type: String, enum: ['text', 'image', 'video', 'file', 'audio', 'location'], default: 'text' },
  media:        {
    filename:     String,
    originalName: String,
    mimetype:     String,
    size:         Number
  },
  location: {
    lat:  Number,
    lng:  Number,
    name: String
  },
  // Un utente per lettura: nelle chat dirette ne conterrà al più uno (il
  // destinatario), in un gruppo uno per ogni membro che l'ha letto — stesso
  // campo per entrambi i tipi di conversazione, invece del vecchio readAt
  // singolo (valido solo finché il destinatario era sempre uno solo).
  readBy:       [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  editedAt:     { type: Date, default: null },
  deleted:      { type: Boolean, default: false }
}, { timestamps: true })

MessageSchema.index({ conversation: 1, createdAt: 1 })

export default mongoose.model('Message', MessageSchema)
