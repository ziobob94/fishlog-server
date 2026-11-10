import mongoose from 'mongoose'
import Group from '../models/Group.js'

/**
 * Restituisce il filtro MongoDB per le sessioni visibili all'utente corrente.
 * - nessun ruolo vede le uscite private altrui (nemmeno admin/moderator)
 * - user vede: proprie + visibility=users + gruppi di cui è membro
 */
export async function visibilityFilter(user) {
  const userId = user.sub
  // Le aggregation pipeline ($match), a differenza di Model.find(), non castano
  // automaticamente una stringa a ObjectId: va fatto esplicitamente, altrimenti
  // il confronto con il campo userId (ObjectId) non trova mai corrispondenza.
  const userObjectId = new mongoose.Types.ObjectId(userId)

  // Gruppi di cui l'utente è membro
  const groups = await Group.find({ members: userId }).select('_id').lean()
  const groupIds = groups.map(g => g._id)

  // moderator/admin: stesso perimetro (la moderazione passa da /hide)
  return {
    hidden: { $ne: true },
    $or: [
      { userId: userObjectId },
      { visibility: 'users' },
      { visibility: 'group', allowedGroups: { $in: groupIds } }
    ]
  }
}

/**
 * Verifica se un utente può modificare/eliminare una sessione.
 * Solo l'autore: nemmeno gli admin modificano le uscite altrui
 * (possono nasconderle con /hide).
 */
export function canEdit(user, session) {
  return !!session.userId && session.userId.toString() === user.sub
}

/**
 * Verifica se un utente può nascondere una sessione.
 * Moderator e admin.
 */
export function canModerate(user) {
  return ['admin', 'moderator'].includes(user.role)
}