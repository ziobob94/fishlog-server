import Group from '../models/Group.js'

/**
 * Restituisce il filtro MongoDB per le sessioni visibili all'utente corrente.
 * - admin/moderator vedono tutto (moderator escluse private altrui)
 * - user vede: proprie + visibility=users + gruppi di cui è membro
 */
export async function visibilityFilter(user) {
  if (user.role === 'admin') {
    return {} // vede tutto
  }

  const userId = user.sub

  // Gruppi di cui l'utente è membro
  const groups = await Group.find({ members: userId }).select('_id').lean()
  const groupIds = groups.map(g => g._id)

  if (user.role === 'moderator') {
    return {
      hidden: { $ne: true },
      $or: [
        { userId },
        { visibility: 'users' },
        { visibility: 'group', allowedGroups: { $in: groupIds } }
      ]
    }
  }

  // ruolo user
  return {
    hidden: { $ne: true },
    $or: [
      { userId },
      { visibility: 'users' },
      { visibility: 'group', allowedGroups: { $in: groupIds } }
    ]
  }
}

/**
 * Verifica se un utente può modificare/eliminare una sessione.
 * Solo autore o admin.
 */
export function canEdit(user, session) {
  return user.role === 'admin' || session.userId?.toString() === user.sub
}

/**
 * Verifica se un utente può nascondere una sessione.
 * Moderator e admin.
 */
export function canModerate(user) {
  return ['admin', 'moderator'].includes(user.role)
}