import mongoose from 'mongoose'

// Valori di configurazione modificabili da pannello admin (eBay, OAuth,
// SMTP, feature flag...) senza dover editare config/local.json e riavviare
// il servizio. Solo le chiavi elencate in configManifest.js sono scrivibili
// dalle route admin.
const RuntimeConfigSchema = new mongoose.Schema({
  key:   { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed }
}, { timestamps: true })

export default mongoose.model('RuntimeConfig', RuntimeConfigSchema)
