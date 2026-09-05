import mongoose from 'mongoose'

const MessageSchema = new mongoose.Schema({
  conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true },
  sender:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  body:         { type: String, required: true, trim: true },
  // Solo chat 1:1: basta un unico readAt (il destinatario è sempre l'altro
  // partecipante) invece di un array di letture per utente.
  readAt:       { type: Date, default: null }
}, { timestamps: true })

MessageSchema.index({ conversation: 1, createdAt: 1 })

export default mongoose.model('Message', MessageSchema)
