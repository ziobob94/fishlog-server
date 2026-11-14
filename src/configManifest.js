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

  // Chiave SERVER per la Google Weather API (mai esposta al client; in alternativa env GOOGLE_WEATHER_KEY).
  // Restringerla per indirizzo IP del server e alla sola Weather API.
  { key: 'google.weatherKey', group: 'Google Weather', label: 'Chiave API Weather', type: 'string', secret: true },
  // Quota: 10.000 richieste gratuite al mese. Avvisi (email agli admin + log) alle soglie indicate; al «blocco» le
  // chiamate a Google si fermano e restano cache e ripiego Open-Meteo. Il contatore si azzera a ogni mese.
  { key: 'google.weatherMonthlyQuota', group: 'Google Weather', label: 'Quota mensile (richieste)', type: 'number', secret: false },
  { key: 'google.weatherAlertPcts',    group: 'Google Weather', label: 'Soglie di avviso in % (es. 70,90)', type: 'string', secret: false },
  { key: 'google.weatherAlertEmail', group: 'Google Weather', label: 'Email per gli avvisi di quota (vuoto = tutti gli admin)', type: 'string', secret: false },
  { key: 'google.weatherStopPct',      group: 'Google Weather', label: 'Blocco automatico al % della quota', type: 'number', secret: false },

  // Catture a voce: interpretazione del testo con Claude. La chiave resta SOLO sul server (in alternativa env ANTHROPIC_API_KEY).
  { key: 'anthropic.apiKey',      group: 'Catture a voce (AI)', label: 'Chiave API Anthropic', type: 'string', secret: true },
  { key: 'anthropic.voiceModel',  group: 'Catture a voce (AI)', label: 'Modello principale (default claude-haiku-5-5)', type: 'string', secret: false },
  { key: 'anthropic.voiceFallbackModel', group: 'Catture a voce (AI)', label: 'Modello di ripiego per casi ambigui (default claude-sonnet-5-5)', type: 'string', secret: false },

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
