import mongoose from 'mongoose'

// Solo chat 1:1 per ora: due partecipanti, sempre gli stessi due utenti
// per un'unica conversazione (niente gruppi di chat).
const ConversationSchema = new mongoose.Schema({
  participants:  [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],
  lastMessageAt: { type: Date, default: Date.now }
}, { timestamps: true })

ConversationSchema.index({ participants: 1 })

export default mongoose.model('Conversation', ConversationSchema)
