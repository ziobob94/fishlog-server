import mongoose from 'mongoose'

// Notifica generica persistita: alimenta il centro notifiche (campanella) e,
// via websocket, gli aggiornamenti realtime dei badge. `data` porta i
// riferimenti utili al frontend per costruire il link contestuale
// (es. { conversationId } per chat_message, { requestId } per friend_request).
const NotificationSchema = new mongoose.Schema({
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type:      { type: String, enum: ['friend_request', 'friend_accept', 'chat_message'], required: true },
  actor:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  data:      { type: mongoose.Schema.Types.Mixed },
  read:      { type: Boolean, default: false }
}, { timestamps: true })

NotificationSchema.index({ recipient: 1, createdAt: -1 })
NotificationSchema.index({ recipient: 1, read: 1 })

export default mongoose.model('Notification', NotificationSchema)
