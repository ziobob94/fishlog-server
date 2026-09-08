import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'

const UserSchema = new mongoose.Schema({
  email:        { type: String, unique: true, sparse: true, lowercase: true, trim: true },
  passwordHash: { type: String },
  displayName:  { type: String },
  avatar:       { type: String },
  providers: {
    google:   { id: String },
    facebook: { id: String }
  },

  role: { type: String, enum: ['user', 'moderator', 'admin'], default: 'user' },

  defaultVisibility: { type: String, enum: ['public', 'users', 'group', 'private'], default: 'public' },

  // Un utente può attivare la "modalità negozio" per pubblicare una vetrina
  // e vedere i propri annunci etichettati come "negozio" invece che "privato".
  // L'attivazione richiede l'approvazione di un admin (verificationStatus):
  // finché non è "verified" gli annunci restano visibili ma etichettati
  // "in verifica" lato client.
  shop: {
    enabled:             { type: Boolean, default: false },
    name:                { type: String, trim: true },
    description:         { type: String, trim: true },
    verificationStatus:  { type: String, enum: ['none', 'pending', 'verified', 'rejected'], default: 'none' },
    verificationRequestedAt: { type: Date },
    verifiedAt:          { type: Date }
  },

  // Preferenze email: ogni chiave è un tipo di notifica indipendente,
  // così si possono aggiungere nuovi tipi senza toccare quelli esistenti.
  notificationPreferences: {
    emailChatMessages:   { type: Boolean, default: true },
    emailComments:       { type: Boolean, default: true },
    emailLikes:          { type: Boolean, default: true },
    emailFriendRequests: { type: Boolean, default: true }
  },

  // Ultima visita alla bacheca generale / alla propria, per calcolare il
  // badge dei "non letti" senza dover tracciare ogni singolo post/risposta.
  lastSeenFeedAt:  { type: Date, default: Date.now },
  lastSeenBoardAt: { type: Date, default: Date.now },

  passwordResetTokenHash: { type: String },
  passwordResetExpires:   { type: Date },

  pendingEmail:         { type: String },
  emailChangeTokenHash: { type: String },
  emailChangeExpires:   { type: Date },

  // Traccia l'accettazione di Termini/Privacy in fase di registrazione
  // (obbligo di consenso informato GDPR): data e versione del testo accettato.
  acceptedTermsAt:     { type: Date },
  acceptedTermsVersion: { type: String }

}, { timestamps: true })

UserSchema.methods.setPassword = async function (plain) {
  this.passwordHash = await bcrypt.hash(plain, 12)
}

UserSchema.methods.checkPassword = async function (plain) {
  return bcrypt.compare(plain, this.passwordHash || '')
}

function sanitizeUser(user) {
  if (!user) return null
  const obj = user.toObject()
  delete obj.passwordHash
  return obj
}

UserSchema.methods.sanitize = function () {
  return sanitizeUser(this.toObject())
}

export default mongoose.model('User', UserSchema)