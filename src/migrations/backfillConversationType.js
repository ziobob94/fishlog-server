import Conversation from '../models/Conversation.js'
import Message from '../models/Message.js'

// Le conversazioni create prima dell'introduzione della chat di gruppo non
// hanno il campo `type` salvato in DB (il default dello schema si applica
// solo ai documenti nuovi). Senza questo backfill, ogni apertura di una
// vecchia chat diretta non trova il documento esistente — la query filtra
// esplicitamente su type:'direct' — e ne crea una copia vuota: da qui gli
// amici duplicati in lista comparsi dopo il deploy dei gruppi. Va eseguita
// una volta ad ogni avvio, prima che il server accetti richieste: è
// idempotente, non fa nulla se non resta più nulla da sistemare.
export async function backfillDirectConversations(log) {
  const { modifiedCount } = await Conversation.updateMany(
    { type: { $exists: false } },
    { $set: { type: 'direct' } }
  )
  if (modifiedCount) log?.info(`Backfill conversazioni dirette: ${modifiedCount} aggiornate`)

  // Ripulisce i duplicati vuoti creati dal bug prima del backfill: per ogni
  // coppia di partecipanti con più di una conversazione diretta, tiene la
  // più vecchia (l'originale) e cancella le altre solo se non hanno mai
  // ricevuto messaggi, per non perdere nessuna conversazione reale.
  const directConversations = await Conversation.find({ type: 'direct' }).sort({ createdAt: 1 }).select('_id participants').lean()
  const seen = new Set()
  const duplicateIds = []
  for (const c of directConversations) {
    const key = c.participants.map(String).sort().join(':')
    if (seen.has(key)) duplicateIds.push(c._id)
    else seen.add(key)
  }
  if (!duplicateIds.length) return

  const withMessages = await Message.distinct('conversation', { conversation: { $in: duplicateIds } })
  const withMessagesSet = new Set(withMessages.map(String))
  const emptyDuplicateIds = duplicateIds.filter(id => !withMessagesSet.has(String(id)))

  if (emptyDuplicateIds.length) {
    await Conversation.deleteMany({ _id: { $in: emptyDuplicateIds } })
    log?.info(`Rimosse ${emptyDuplicateIds.length} conversazioni dirette duplicate e vuote`)
  }
}
