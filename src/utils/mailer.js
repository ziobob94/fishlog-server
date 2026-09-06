import nodemailer from 'nodemailer'
import Handlebars from 'handlebars'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import AppConfig from '../config.js'

const cfg = new AppConfig()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEMPLATES_DIR = path.resolve(__dirname, '../emails/templates')
const PARTIALS_DIR  = path.resolve(__dirname, '../emails/partials')

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

// Ricava una versione testuale approssimativa dall'HTML: i filtri antispam
// penalizzano pesantemente le email che hanno solo la parte HTML.
function htmlToText(html) {
  return html
    .replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gis, '$2 ($1)')
    .replace(/<\/(p|div|h[1-6])>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export async function sendMail({ to, subject, html }) {
  const text = htmlToText(html)
  const t = getTransport()
  if (!t) {
    console.log(`[mail:dev] to=${to} subject="${subject}"\n${html}\n`)
    return
  }
  await t.sendMail({ from: cfg.get('mail.from', 'Fishlog <no-reply@fishlog.local>'), to, subject, html, text })
}

// Ogni file .hbs viene compilato una sola volta e tenuto in cache: i
// template non cambiano a runtime, ricompilarli ad ogni invio sarebbe
// solo overhead.
const compiledTemplates = new Map()

function compile(name, dir) {
  const key = `${dir}/${name}`
  if (!compiledTemplates.has(key)) {
    const source = fs.readFileSync(path.join(dir, `${name}.hbs`), 'utf8')
    compiledTemplates.set(key, Handlebars.compile(source))
  }
  return compiledTemplates.get(key)
}

Handlebars.registerPartial('layout', compile('layout', PARTIALS_DIR))

function render(title, templateName, data) {
  const body = compile(templateName, TEMPLATES_DIR)(data)
  return Handlebars.compile('{{> layout}}')({ title, body })
}

export function welcomeEmail(displayName, link) {
  return {
    subject: 'Benvenuto su Fishlog!',
    html: render('Benvenuto su Fishlog', 'welcome', { displayName, link })
  }
}

export function securityAlertEmail(actionText) {
  return {
    subject: 'Fishlog — avviso di sicurezza',
    html: render('Avviso di sicurezza', 'security-alert', { actionText })
  }
}

export function passwordResetEmail(link) {
  return {
    subject: 'Fishlog — reimposta la tua password',
    html: render('Reimposta password', 'password-reset', { link })
  }
}

export function emailChangeConfirmEmail(link) {
  return {
    subject: 'Fishlog — conferma il cambio email',
    html: render('Conferma nuova email', 'email-change-confirm', { link })
  }
}

export function newChatMessageEmail(senderName, preview, link) {
  return {
    subject: `Fishlog — nuovo messaggio da ${senderName}`,
    html: render('Nuovo messaggio', 'new-chat-message', { senderName, preview, link })
  }
}

export function newCommentEmail(authorName, preview, link) {
  return {
    subject: `Fishlog — ${authorName} ha commentato il tuo post`,
    html: render('Nuovo commento', 'new-comment', { authorName, preview, link })
  }
}

export function newLikeEmail(actorName, link) {
  return {
    subject: `Fishlog — ${actorName} ha messo like al tuo post`,
    html: render('Nuovo like', 'new-like', { actorName, link })
  }
}

export function newFollowerEmail(actorName, link) {
  return {
    subject: `Fishlog — ${actorName} ha iniziato a seguirti`,
    html: render('Nuovo follower', 'new-follower', { actorName, link })
  }
}

export function friendRequestEmail(actorName, link) {
  return {
    subject: `Fishlog — ${actorName} ti ha inviato una richiesta di amicizia`,
    html: render('Richiesta di amicizia', 'friend-request', { actorName, link })
  }
}
