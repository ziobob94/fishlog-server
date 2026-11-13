import mongoose from 'mongoose'
import FipsasProva from '../models/FipsasProva.js'

/**
 * Ruoli per prova (non esiste un ruolo globale di gara):
 * - organizer: il proprietario; gestisce dati, iscritti, sorteggio, giudici, pubblicazione
 * - judge: scrive le pesate (e solo lui: nemmeno l'organizzatore, se non è anche giudice)
 */
export async function loadProva(id, userId) {
  if (!mongoose.isValidObjectId(id)) return { error: 404 }
  const prova = await FipsasProva.findById(id)
  if (!prova) return { error: 404 }
  const uid = String(userId)
  const isOrganizer = String(prova.owner) === uid
  const isJudge = prova.judges.some((j) => String(j) === uid)
  if (!isOrganizer && !isJudge) return { error: 404 } // niente indizi su prove altrui
  return { prova, isOrganizer, isJudge }
}

export function guard(reply, res, need) {
  if (res.error) { reply.status(res.error).send({ error: 'Prova non trovata' }); return false }
  if (need === 'organizer' && !res.isOrganizer) { reply.status(403).send({ error: 'Solo l’organizzatore può farlo' }); return false }
  if (need === 'judge' && !res.isJudge) { reply.status(403).send({ error: 'Solo il giudice può registrare le pesate' }); return false }
  return true
}
