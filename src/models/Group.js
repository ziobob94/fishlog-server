import mongoose from 'mongoose'

const GroupSchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true },
  description: { type: String },
  owner:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  members:     [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}, { timestamps: true })

GroupSchema.index({ owner: 1 })
GroupSchema.index({ members: 1 })

export default mongoose.model('Group', GroupSchema)