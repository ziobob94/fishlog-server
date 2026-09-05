import mongoose from 'mongoose'

// Una riga per ogni coppia di utenti: "pending" finché il destinatario non
// risponde, poi resta "accepted" (l'amicizia stessa) — non serve un'altra
// collezione per la lista amici, basta filtrare per status.
const FriendshipSchema = new mongoose.Schema({
  requester: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status:    { type: String, enum: ['pending', 'accepted'], default: 'pending' }
}, { timestamps: true })

FriendshipSchema.index({ requester: 1, recipient: 1 }, { unique: true })
FriendshipSchema.index({ recipient: 1, status: 1 })

export default mongoose.model('Friendship', FriendshipSchema)
