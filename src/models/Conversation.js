import mongoose from 'mongoose'

// "direct": sempre esattamente due partecipanti, creata al volo alla prima
// chat tra due amici. "group": tre o più, con un nome e un proprietario che
// gestisce i membri.
const ConversationSchema = new mongoose.Schema({
  type:          { type: String, enum: ['direct', 'group'], default: 'direct' },
  participants:  [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],
  lastMessageAt: { type: Date, default: Date.now },

  // Solo per i gruppi:
  name:  { type: String, trim: true },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  // Preferito personale: chi tra i partecipanti l'ha segnata, non è uno
  // stato condiviso (gli altri possono non averla tra i preferiti).
  favoritedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}, { timestamps: true })

ConversationSchema.index({ participants: 1 })

export default mongoose.model('Conversation', ConversationSchema)
