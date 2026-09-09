// Whitelist delle chiavi di configurazione modificabili da interfaccia admin.
// Solo queste chiavi possono essere lette/scritte tramite /api/admin/config:
// tutto ciò che serve per avviare il processo (porta, host, url mongodb,
// jwt secret, cartella upload...) resta in config/local.json perché va
// letto prima ancora che il DB sia connesso, e cambiarlo comunque
// richiederebbe un riavvio.
export const CONFIG_MANIFEST = [
  { key: 'ebay.clientId',     group: 'eBay',            label: 'Client ID',     type: 'string',  secret: false },
  { key: 'ebay.clientSecret', group: 'eBay',            label: 'Client Secret', type: 'string',  secret: true },
  { key: 'ebay.sandbox',      group: 'eBay',            label: 'Modalità sandbox', type: 'boolean', secret: false },
  // Deve combaciare esattamente con il "Verification Token" impostato nella
  // configurazione "Marketplace Account Deletion" del Developer Portal eBay
  // (richiesto da eBay per attivare il keyset di produzione). Non "secret":
  // va ricopiato nel portale eBay, quindi deve restare leggibile da qui.
  { key: 'ebay.verificationToken', group: 'eBay', label: 'Verification Token (Marketplace Account Deletion)', type: 'string', secret: false },

  { key: 'oauth.google.clientId',     group: 'Google OAuth', label: 'Client ID',     type: 'string',  secret: false },
  { key: 'oauth.google.clientSecret', group: 'Google OAuth', label: 'Client Secret', type: 'string',  secret: true },
  { key: 'oauth.google.callbackUrl',  group: 'Google OAuth', label: 'Callback URL', type: 'string',  secret: false },

  { key: 'oauth.facebook.appId',        group: 'Facebook OAuth', label: 'App ID',        type: 'string', secret: false },
  { key: 'oauth.facebook.appSecret',    group: 'Facebook OAuth', label: 'App Secret',    type: 'string', secret: true },
  { key: 'oauth.facebook.callbackUrl',  group: 'Facebook OAuth', label: 'Callback URL', type: 'string', secret: false },

  { key: 'mail.smtp.host',   group: 'Email (SMTP)', label: 'Host',              type: 'string',  secret: false },
  { key: 'mail.smtp.port',   group: 'Email (SMTP)', label: 'Porta',             type: 'number',  secret: false },
  { key: 'mail.smtp.secure', group: 'Email (SMTP)', label: 'Connessione SSL/TLS', type: 'boolean', secret: false },
  { key: 'mail.smtp.user',   group: 'Email (SMTP)', label: 'Utente',            type: 'string',  secret: false },
  { key: 'mail.smtp.pass',   group: 'Email (SMTP)', label: 'Password',          type: 'string',  secret: true },
  { key: 'mail.from',        group: 'Email (SMTP)', label: 'Mittente',          type: 'string',  secret: false },

  { key: 'features.passwordAuth', group: 'Feature flags', label: 'Login con email e password abilitato', type: 'boolean', secret: false },

  // Dati del Titolare del trattamento, mostrati pubblicamente nelle pagine
  // Privacy/Termini del client (GET /api/legal, nessuna autenticazione
  // richiesta): finché non vengono compilati qui, il client mostra un
  // segnaposto generico al posto di questi campi.
  { key: 'legal.companyName',   group: 'Dati legali (Privacy/Termini)', label: 'Titolare (nome o ragione sociale)', type: 'string', secret: false },
  { key: 'legal.address',       group: 'Dati legali (Privacy/Termini)', label: 'Indirizzo',                        type: 'string', secret: false },
  { key: 'legal.taxId',         group: 'Dati legali (Privacy/Termini)', label: 'Codice Fiscale / P.IVA',           type: 'string', secret: false },
  { key: 'legal.contactEmail',  group: 'Dati legali (Privacy/Termini)', label: 'Email di contatto privacy',        type: 'string', secret: false }
]

export const CONFIG_MANIFEST_BY_KEY = Object.fromEntries(CONFIG_MANIFEST.map(m => [m.key, m]))
