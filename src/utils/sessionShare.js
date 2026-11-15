export const SHARE_TOKEN_RE = /^[\w-]{10,24}$/

// URL pubblico da condividere: pagina HTML del server con anteprima Open Graph,
// che poi porta chi la apre alla vista pubblica del client.
export function shareUrl(req, token) {
  return `${req.protocol}://${req.headers.host}/api/public/sessions/${token}/page`
}

export function clientShareUrl(clientUrl, token) {
  return `${clientUrl}/uscita/${token}`
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

function durationLabel(s) {
  if (!s.startTime || !s.endTime) return null
  const [h1, m1] = s.startTime.split(':').map(Number)
  const [h2, m2] = s.endTime.split(':').map(Number)
  if ([h1, m1, h2, m2].some(Number.isNaN)) return null
  let min = (h2 * 60 + m2) - (h1 * 60 + m1)
  if (s.endDate && s.date) min += Math.round((new Date(s.endDate) - new Date(s.date)) / 86400000) * 1440
  else if (min < 0) min += 1440
  return { hours: Math.floor(min / 60), minutes: min % 60 }
}

// Solo ciò che si può mostrare a chiunque abbia il link: niente coordinate,
// note, esche/montature, id utente, email. L'autore compare con il nome visualizzato.
export function publicSessionView(session, author, baseUrl) {
  const photos = [
    ...(session.media || []),
    ...(session.catches || []).flatMap(c => c.media || [])
  ].filter(m => m.type === 'photo').slice(0, 8).map(m => ({ url: `${baseUrl}/uploads/${m.filename}`, caption: m.caption || '' }))
  return {
    title: session.title || session.location?.name || '',
    date: session.date,
    startTime: session.startTime || null,
    endTime: session.endTime || null,
    duration: durationLabel(session),
    technique: session.technique || null,
    waterType: session.waterType || null,
    place: [session.location?.name, session.location?.region].filter(Boolean).join(' · '),
    author: author?.displayName || null,
    catches: (session.catches || []).map(c => ({ species: c.species, weightKg: c.weightKg ?? null, lengthCm: c.lengthCm ?? null, released: !!c.released })),
    totalCatches: session.catches?.length || 0,
    photos
  }
}

export function previewText(v) {
  const bits = []
  bits.push(`${v.totalCatches} ${v.totalCatches === 1 ? 'cattura' : 'catture'}`)
  const best = v.catches.reduce((a, c) => ((c.lengthCm || 0) > (a?.lengthCm || 0) ? c : a), null)
  if (best?.lengthCm) bits.push(`${best.species} ${String(best.lengthCm).replace('.', ',')} cm`)
  if (v.duration) bits.push(`${v.duration.hours}h${v.duration.minutes ? String(v.duration.minutes).padStart(2, '0') : ''}`)
  if (v.place) bits.push(v.place)
  return bits.join(' · ')
}

export function renderSharePage(v, target) {
  const title = v.title || 'Uscita di pesca'
  const desc = previewText(v)
  const img = v.photos[0]?.url
  return `<!doctype html>
<html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Fishlog</title>
<meta name="robots" content="noindex">
<meta property="og:type" content="article"><meta property="og:site_name" content="Fishlog">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
${img ? `<meta property="og:image" content="${esc(img)}"><meta name="twitter:card" content="summary_large_image">` : '<meta name="twitter:card" content="summary">'}
<meta property="og:url" content="${esc(target)}">
<meta http-equiv="refresh" content="0;url=${esc(target)}">
</head><body><p><a href="${esc(target)}">${esc(title)}</a></p></body></html>`
}
