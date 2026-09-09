import Message from '../models/Message.js'
import Conversation from '../models/Conversation.js'

// I messaggi creati prima dell'introduzione della chat di gruppo hanno il
// vecchio campo `readAt` (letto/non letto) ancora in DB, ma non `readBy`
// (non esisteva nello schema quando sono stati creati): da qui la doppia
// spunta blu sparita sui messaggi già letti, perché readBy risulta vuoto
// anche dove readAt era valorizzato. Va eseguita una volta ad ogni avvio,
// prima che il server accetti richieste: è idempotente, non fa nulla se
// non resta più nulla da sistemare.
export async function backfillMessageReadBy(log) {
  const legacyMessages = await Message.find({ readBy: { $exists: false } })
    .select('_id conversation sender readAt')
    .lean()
  if (!legacyMessages.length) return

  const conversationIds = [...new Set(legacyMessages.map(m => String(m.conversation)))]
  const conversations = await Conversation.find({ _id: { $in: conversationIds } }).select('_id participants').lean()
  const participantsByConversation = new Map(conversations.map(c => [String(c._id), c.participants.map(String)]))

  const bulkOps = legacyMessages.map(m => {
    const participants = participantsByConversation.get(String(m.conversation)) || []
    // Le dirette d'epoca avevano un solo destinatario possibile: se il
    // messaggio risultava letto, lo è stato dall'altro partecipante.
    const readBy = m.readAt ? participants.filter(p => p !== String(m.sender)) : []
    return { updateOne: { filter: { _id: m._id }, update: { $set: { readBy }, $unset: { readAt: '' } } } }
  })

  await Message.bulkWrite(bulkOps)
  log?.info(`Backfill readBy: ${bulkOps.length} messaggi aggiornati`)
}
