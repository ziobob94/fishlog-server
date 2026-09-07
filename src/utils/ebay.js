import AppConfig from '../config.js'

const cfg = new AppConfig()

function apiBase() {
  return cfg.get('ebay.sandbox', false)
    ? 'https://api.sandbox.ebay.com'
    : 'https://api.ebay.com'
}

function isConfigured() {
  return !!(cfg.get('ebay.clientId', '') && cfg.get('ebay.clientSecret', ''))
}

// Token OAuth2 client-credentials (scope "sola lettura" per il catalogo
// pubblico), valido ~2h: lo teniamo in cache in memoria e lo rinnoviamo
// solo quando è scaduto, per non richiederne uno ad ogni ricerca.
let cachedToken = null
let tokenExpiresAt = 0

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken

  const clientId = cfg.get('ebay.clientId', '')
  const clientSecret = cfg.get('ebay.clientSecret', '')
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  const res = await fetch(`${apiBase()}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'https://api.ebay.com/oauth/api_scope'
    })
  })

  if (!res.ok) throw new Error(`eBay token request failed: ${res.status}`)

  const data = await res.json()
  cachedToken = data.access_token
  tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000 // margine di 60s
  return cachedToken
}

// Ricerca nel catalogo pubblico eBay (marketplace Italia). eBay non offre
// una vera ricerca "per distanza" sugli annunci generici come un portale di
// annunci locali: il codice postale serve solo a stimare le spese/tempi di
// consegna mostrati nei risultati, non a ordinarli per vicinanza reale.
export async function searchEbay({ query, zip, limit = 12 }) {
  if (!isConfigured()) return { configured: false, data: [] }

  const token = await getAccessToken()

  const params = new URLSearchParams({
    q: query || 'attrezzatura da pesca',
    limit: String(Math.min(limit, 50))
  })

  const headers = {
    'Authorization': `Bearer ${token}`,
    'X-EBAY-C-MARKETPLACE-ID': 'EBAY_IT'
  }
  if (zip) headers['X-EBAY-C-ENDUSERCTX'] = `contextualLocation=country=IT,zip=${zip}`

  const res = await fetch(`${apiBase()}/buy/browse/v1/item_summary/search?${params}`, { headers })
  if (!res.ok) throw new Error(`eBay search failed: ${res.status}`)

  const data = await res.json()
  const items = (data.itemSummaries || []).map(i => ({
    source: 'ebay',
    externalId: i.itemId,
    title: i.title,
    price: i.price?.value ? Number(i.price.value) : null,
    currency: i.price?.currency || 'EUR',
    condition: i.condition || null,
    image: i.image?.imageUrl || null,
    url: i.itemWebUrl,
    location: i.itemLocation ? [i.itemLocation.city, i.itemLocation.postalCode].filter(Boolean).join(' ') : null
  }))

  return { configured: true, data: items }
}
