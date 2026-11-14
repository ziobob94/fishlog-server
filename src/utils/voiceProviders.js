// Fornitori AI per le catture a voce. Predefinito: Gemini (piano gratuito di Google AI Studio); alternativa: Anthropic.
// Scelta: `voice.provider` (env VOICE_AI_PROVIDER) = 'gemini' | 'anthropic'; se vuoto, Gemini se c'è la sua chiave,
// altrimenti Anthropic se c'è la sua chiave, altrimenti nessuno (la route ripiega sul parser a regole).
// Le chiavi restano SOLO sul server: env (GEMINI_API_KEY / ANTHROPIC_API_KEY) o Admin → Configurazione.
import Anthropic from '@anthropic-ai/sdk'
import AppConfig from '../config.js'
import { TOOL, SYSTEM } from './voiceCatch.js'

const config = new AppConfig()
const env = (k, ck, d = '') => String(process.env[k] || config.get(ck, '') || d).trim()

// Errore normalizzato: code = rate_limit | auth | unavailable | bad_response
export class VoiceAiError extends Error {
  constructor(code, message, { retryAfter, status } = {}) { super(message); this.code = code; this.retryAfter = retryAfter; this.status = status }
}

// Modelli: documentazione ufficiale Gemini (pricing, 2026-10): gemini-3.1-flash-lite e gemini-3.5-flash hanno il piano gratuito.
export const GEMINI_DEFAULT_MODEL = 'gemini-3.1-flash-lite'
export const GEMINI_DEFAULT_FALLBACK = 'gemini-3.5-flash'
export const ANTHROPIC_DEFAULT_MODEL = 'claude-haiku-5-5'
export const ANTHROPIC_DEFAULT_FALLBACK = 'claude-sonnet-5-5'

const geminiKey = () => env('GEMINI_API_KEY', 'gemini.apiKey')
const anthropicKey = () => env('ANTHROPIC_API_KEY', 'anthropic.apiKey')

// Messaggio utente: ora locale, stato dell'app (uscita in corso, se noto) e testo dettato.
const userMessage = (text, ctx) => `Ora locale del pescatore: ${ctx.time || 'non nota'}.\n${ctx.state ? ctx.state + '\n' : ''}Testo dettato: \"\"\"${text}\"\"\"`
const toolsOf = ctx => ctx.tools || [TOOL]

// ── Gemini (REST generateContent, function calling) ───────────────────────────
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models'
const geminiDeclaration = (tool) => {
  const { additionalProperties, ...schema } = tool.input_schema // non supportato dallo schema Gemini
  return { name: tool.name, description: tool.description, parameters: schema }
}
// "retryDelay": "34s" nei dettagli dell'errore, oppure intestazione Retry-After.
export function parseRetryAfter(body, header) {
  const d = body?.error?.details?.find?.(x => x?.retryDelay)?.retryDelay
  const sec = parseFloat(d) || parseFloat(header)
  return Number.isFinite(sec) && sec > 0 ? Math.ceil(sec) : undefined
}

export async function geminiCall(model, text, ctx = {}, { fetchFn = fetch, key = geminiKey() } = {}) {
  let res
  try {
    res = await fetchFn(`${GEMINI_URL}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      signal: AbortSignal.timeout(20000),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: ctx.system || SYSTEM }] },
        contents: [{ role: 'user', parts: [{ text: userMessage(text, ctx) }] }],
        tools: [{ functionDeclarations: toolsOf(ctx).map(geminiDeclaration) }],
        toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
        generationConfig: { maxOutputTokens: 1024 }
      })
    })
  } catch (e) {
    throw new VoiceAiError('unavailable', `Gemini non raggiungibile: ${e.message}`)
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = body?.error?.message || `HTTP ${res.status}`
    if (res.status === 429) throw new VoiceAiError('rate_limit', msg, { status: 429, retryAfter: parseRetryAfter(body, res.headers.get?.('retry-after')) })
    if (res.status === 401 || res.status === 403 || /api key/i.test(msg)) throw new VoiceAiError('auth', msg, { status: res.status })
    throw new VoiceAiError('unavailable', msg, { status: res.status })
  }
  if (body.promptFeedback?.blockReason) return { calls: [], raw: [], reply: '', refused: true }
  const parts = body.candidates?.[0]?.content?.parts || []
  const calls = parts.filter(p => p.functionCall?.name).map(p => ({ name: p.functionCall.name, args: p.functionCall.args || {} }))
  const reply = parts.filter(p => typeof p.text === 'string' && !p.thought).map(p => p.text).join(' ').trim()
  return { calls, raw: calls.filter(c => c.name === TOOL.name).map(c => c.args), reply }
}

// ── Anthropic (SDK ufficiale) ─────────────────────────────────────────────────
let _anthropic = null
const anthropicClient = () => (_anthropic ??= new Anthropic({ apiKey: anthropicKey(), maxRetries: 1, timeout: 20000 }))

export async function anthropicCall(model, text, ctx = {}, { client = anthropicClient() } = {}) {
  let res
  try {
    res = await client.messages.create({
      model,
      max_tokens: 1024,
      system: ctx.system || SYSTEM,
      tools: toolsOf(ctx).map(t => ({ ...t, strict: true })),
      tool_choice: { type: 'auto' }, // con i modelli 5.x non si può forzare lo strumento: lo guida il prompt
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: userMessage(text, ctx) }]
    })
  } catch (e) {
    const st = e?.status
    if (st === 429) throw new VoiceAiError('rate_limit', e.message, { status: st, retryAfter: parseRetryAfter(null, e.headers?.['retry-after']) })
    if (st === 401 || st === 403) throw new VoiceAiError('auth', e.message, { status: st })
    throw new VoiceAiError('unavailable', e.message, { status: st })
  }
  if (res.stop_reason === 'refusal') return { calls: [], raw: [], reply: '', refused: true }
  const calls = res.content.filter(b => b.type === 'tool_use').map(b => ({ name: b.name, args: b.input || {} }))
  const reply = res.content.filter(b => b.type === 'text').map(b => b.text).join(' ').trim()
  return { calls, raw: calls.filter(c => c.name === TOOL.name).map(c => c.args), reply }
}

// ── Scelta del fornitore attivo ───────────────────────────────────────────────
export function activeProvider() {
  const want = env('VOICE_AI_PROVIDER', 'voice.provider').toLowerCase()
  const name = want === 'gemini' || want === 'anthropic' ? want : (geminiKey() ? 'gemini' : (anthropicKey() ? 'anthropic' : ''))
  if (name === 'gemini' && geminiKey()) return {
    name,
    models: { primary: env('GEMINI_VOICE_MODEL', 'gemini.voiceModel', GEMINI_DEFAULT_MODEL), fallback: env('GEMINI_VOICE_FALLBACK_MODEL', 'gemini.voiceFallbackModel', GEMINI_DEFAULT_FALLBACK) },
    call: (m, t, c) => geminiCall(m, t, c)
  }
  if (name === 'anthropic' && anthropicKey()) return {
    name,
    models: { primary: env('ANTHROPIC_VOICE_MODEL', 'anthropic.voiceModel', ANTHROPIC_DEFAULT_MODEL), fallback: env('ANTHROPIC_VOICE_FALLBACK_MODEL', 'anthropic.voiceFallbackModel', ANTHROPIC_DEFAULT_FALLBACK) },
    call: (m, t, c) => anthropicCall(m, t, c)
  }
  return null
}

// Dopo un 429 si smette di chiamare il fornitore per `retry-after` (default 60 s): si va dritti al ripiego
// invece di sprecare richieste (e quota) contro un limite già raggiunto.
let cooldownUntil = 0
export const inCooldown = () => Date.now() < cooldownUntil
export const cooldownLeft = () => Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000))
export function startCooldown(seconds) { cooldownUntil = Date.now() + Math.min(Math.max(seconds || 60, 5), 3600) * 1000 }
export function resetCooldown() { cooldownUntil = 0 }
