// Aggiunge `url` ai media della sessione e a quelli di ogni cattura (il DB
// salva solo `filename`): senza, il client non mostra le foto delle catture.
export function withMediaUrls(session, baseUrl) {
  if (!session) return session
  const add = m => ({ ...m, url: `${baseUrl}/uploads/${m.filename}` })
  if (Array.isArray(session.media)) session.media = session.media.map(add)
  if (Array.isArray(session.catches)) {
    session.catches = session.catches.map(c => ({ ...c, media: Array.isArray(c.media) ? c.media.map(add) : c.media }))
  }
  return session
}
