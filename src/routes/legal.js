import AppConfig from '../config.js'

const cfg = new AppConfig()

// Rotta pubblica (nessuna autenticazione): le pagine Privacy/Termini del
// client sono accessibili anche a chi non ha un account, quindi i dati del
// Titolare del trattamento vanno letti da qui e non da /api/admin/config.
// I valori sono modificabili da pannello admin (vedi configManifest.js) e
// vengono riletti automaticamente grazie al runtimeConfigStore periodico.
export default async function legalRoutes(app) {
  app.get('/', async () => ({
    companyName:  cfg.get('legal.companyName', ''),
    address:      cfg.get('legal.address', ''),
    taxId:        cfg.get('legal.taxId', ''),
    contactEmail: cfg.get('legal.contactEmail', '')
  }))
}
