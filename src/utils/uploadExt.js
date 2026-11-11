import path from 'path'

// Estensioni che un browser può interpretare come pagina/script se servite
// da /uploads (stessa origin delle API): mai riutilizzarle dal nome file
// scelto dal client.
const UNSAFE = new Set(['.html', '.htm', '.xhtml', '.shtml', '.svg', '.svgz', '.xml', '.xsl', '.js', '.mjs', '.cjs', '.php', '.swf', '.jsp', '.asp', '.aspx'])

// Estensione sicura derivata dal nome originale: solo caratteri semplici e
// non eseguibili dal browser, altrimenti il fallback.
export function safeExt(filename = '', fallback = '') {
  const ext = path.extname(filename || '').toLowerCase()
  if (!/^\.[a-z0-9]{1,8}$/.test(ext) || UNSAFE.has(ext)) return fallback
  return ext
}
