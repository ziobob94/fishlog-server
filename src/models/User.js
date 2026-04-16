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

  role: { type: String, enum: ['user', 'moderator', 'admin'], default: 'user' }

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