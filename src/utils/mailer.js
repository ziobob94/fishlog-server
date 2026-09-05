import nodemailer from 'nodemailer'
import AppConfig from '../config.js'

const cfg = new AppConfig()

let transport = null
let transportChecked = false

// Lazy + cache: se l'SMTP non è configurato (dev senza credenziali reali),
// non si costruisce alcun transport e sendMail logga su console invece di
// fallire — così i flussi email si possono testare senza un provider vero.
function getTransport() {
  if (transportChecked) return transport
  transportChecked = true

  const host = cfg.get('mail.smtp.host', '')
  if (!host) return null

  transport = nodemailer.createTransport({
    host,
    port: cfg.get('mail.smtp.port', 587),
    secure: cfg.get('mail.smtp.secure', false),
    auth: cfg.get('mail.smtp.user', '')
      ? { user: cfg.get('mail.smtp.user'), pass: cfg.get('mail.smtp.pass', '') }
      : undefined
  })
  return transport
}

export async function sendMail({ to, subject, html }) {
  const t = getTransport()
  if (!t) {
    console.log(`[mail:dev] to=${to} subject="${subject}"\n${html}\n`)
    return
  }
  await t.sendMail({ from: cfg.get('mail.from', 'Fishlog <no-reply@fishlog.local>'), to, subject, html })
}

function wrap(title, bodyHtml) {
  return `<div style="font-family:sans-serif;max-width:480px;margin:0 auto">
    <h2 style="color:#0ea5e9">${title}</h2>
    ${bodyHtml}
    <p style="color:#888;font-size:.8rem;margin-top:2rem">Fishlog</p>
  </div>`
}

export function securityAlertEmail(actionText) {
  return {
    subject: 'Fishlog — avviso di sicurezza',
    html: wrap('Avviso di sicurezza', `<p>${actionText}</p><p>Se non sei stato tu, contatta subito il supporto.</p>`)
  }
}

export function passwordResetEmail(link) {
  return {
    subject: 'Fishlog — reimposta la tua password',
    html: wrap('Reimposta password', `
      <p>Hai richiesto di reimpostare la password del tuo account Fishlog.</p>
      <p><a href="${link}" style="color:#0ea5e9">Clicca qui per impostare una nuova password</a></p>
      <p>Il link scade tra 1 ora. Se non hai richiesto tu il reset, ignora questa email.</p>
    `)
  }
}

export function emailChangeConfirmEmail(link) {
  return {
    subject: 'Fishlog — conferma il cambio email',
    html: wrap('Conferma nuova email', `
      <p>Hai richiesto di cambiare l'email del tuo account Fishlog a questo indirizzo.</p>
      <p><a href="${link}" style="color:#0ea5e9">Clicca qui per confermare</a></p>
      <p>Il link scade tra 24 ore. Se non hai richiesto tu il cambio, ignora questa email.</p>
    `)
  }
}
