// Registro in-memory delle connessioni websocket per utente. Un utente può
// avere più connessioni aperte (più tab/dispositivi); l'invio è best-effort,
// se l'utente è offline la notifica resta comunque persistita in DB.
const connectionsByUser = new Map()

export function registerConnection(userId, connection) {
  const key = userId.toString()
  if (!connectionsByUser.has(key)) connectionsByUser.set(key, new Set())
  connectionsByUser.get(key).add(connection)

  connection.on('close', () => {
    const set = connectionsByUser.get(key)
    if (!set) return
    set.delete(connection)
    if (set.size === 0) connectionsByUser.delete(key)
  })
}

export function sendToUser(userId, event) {
  const set = connectionsByUser.get(userId.toString())
  if (!set) return
  const payload = JSON.stringify(event)
  for (const connection of set) {
    if (connection.readyState === connection.OPEN) connection.send(payload)
  }
}
