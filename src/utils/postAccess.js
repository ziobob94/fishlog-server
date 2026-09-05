import mongoose from 'mongoose'
import Group from '../models/Group.js'

/**
 * Restituisce il filtro MongoDB per i post visibili all'utente corrente.
 * - admin vede tutto
 * - altri vedono: pubblici + propri + gruppo (se membro di allowedGroups)
 */
export async function visibilityFilter(user) {
  if (user.role === 'admin') {
    return {}
  }

  const userId = user.sub
  const userObjectId = new mongoose.Types.ObjectId(userId)

  const groups = await Group.find({ $or: [{ owner: userId }, { members: userId }] }).select('_id').lean()
  const groupIds = groups.map(g => g._id)

  return {
    $or: [
      { author: userObjectId },
      { visibility: 'public' },
      { visibility: 'group', allowedGroups: { $in: groupIds } }
    ]
  }
}

/**
 * Verifica se un utente può modificare/eliminare un post.
 * Solo autore o admin.
 */
export function canEdit(user, post) {
  return user.role === 'admin' || post.author?.toString() === user.sub
}
