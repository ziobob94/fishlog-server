import mongoose from 'mongoose'
import Friendship from '../models/Friendship.js'
import Group from '../models/Group.js'

// Proprietario dell'annuncio o admin possono modificarlo/eliminarlo.
export function canEdit(user, listing) {
  if (!user || !listing) return false
  if (user.role === 'admin') return true
  return listing.seller.toString() === user.sub
}

// Filtro MongoDB degli annunci visibili a `userId` (null = anonimo → solo «tutti»).
// Senza campo `visibility` (annunci esistenti) vale «tutti». Il venditore vede sempre i propri.
export async function listingVisibilityFilter(userId) {
  const everyone = { visibility: { $in: ['all', null] } }
  if (!userId) return everyone
  const me = new mongoose.Types.ObjectId(userId)
  const [friendships, groups] = await Promise.all([
    Friendship.find({ status: 'accepted', $or: [{ requester: me }, { recipient: me }] }).select('requester recipient').lean(),
    Group.find({ members: me }).select('_id').lean()
  ])
  const friendIds = friendships.map(f => (f.requester.equals(me) ? f.recipient : f.requester))
  return {
    $or: [
      everyone,
      { seller: me },
      { visibility: 'friends', seller: { $in: friendIds } },
      { visibility: 'groups', allowedGroups: { $in: groups.map(g => g._id) } }
    ]
  }
}

// Normalizza visibilità e gruppi dal body: i gruppi devono essere dell'utente.
export async function parseVisibility(userId, body) {
  const visibility = body.visibility
  if (visibility === undefined) return {}
  if (!['all', 'friends', 'groups'].includes(visibility)) return { error: 'Visibilità non valida' }
  if (visibility !== 'groups') return { visibility, allowedGroups: [] }
  const ids = [...new Set((body.allowedGroups || []).map(String))]
  if (!ids.length) return { error: 'Scegli almeno un gruppo' }
  const mine = await Group.find({ _id: { $in: ids }, members: userId }).select('_id').lean()
  if (mine.length !== ids.length) return { error: 'Puoi scegliere solo gruppi di cui fai parte' }
  return { visibility, allowedGroups: mine.map(g => g._id) }
}
