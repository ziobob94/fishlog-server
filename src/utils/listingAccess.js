// Proprietario dell'annuncio o admin possono modificarlo/eliminarlo.
export function canEdit(user, listing) {
  if (!user || !listing) return false
  if (user.role === 'admin') return true
  return listing.seller.toString() === user.sub
}
