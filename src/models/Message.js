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
  // Solo chat 1:1: basta un unico readAt (il destinatario è sempre l'altro
  // partecipante) invece di un array di letture per utente.
  readAt:       { type: Date, default: null }
}, { timestamps: true })

MessageSchema.index({ conversation: 1, createdAt: 1 })

export default mongoose.model('Message', MessageSchema)
