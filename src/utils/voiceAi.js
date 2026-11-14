// Esegue l'interpretazione di una frase dettata: modello AI (con ripiego sul modello più capace), poi, se il
// servizio è al limite/non raggiungibile/non configurato, parser a regole. Usato dall'assistente.
import { interpretWithFallback } from './voiceCatch.js'
import { activeProvider, VoiceAiError, inCooldown, cooldownLeft, startCooldown } from './voiceProviders.js'
import { parseAssistantWithRules } from './voiceRules.js'
import { ASSISTANT_TOOLS, ASSISTANT_SYSTEM } from './assistantTools.js'

const MESSAGES = {
  rate_limit: s => `Il servizio AI ha raggiunto il limite di richieste${s ? `: riprova tra circa ${s} s` : ''}.`,
  auth: () => 'La chiave del servizio AI non è valida: avvisa l\'amministratore.',
  no_provider: () => 'Fishy non è configurato: manca la chiave del servizio AI.',
  unavailable: () => 'Il servizio AI non è raggiungibile al momento, riprova.'
}

// → { out, provider, degraded?, retryAfter? }  oppure  { failure: { status, code, error, retryAfter? } }
export async function runAssistant(text, { time, state, log } = {}) {
  const provider = activeProvider()
  const ctx = { time, state, tools: ASSISTANT_TOOLS, system: ASSISTANT_SYSTEM }
  let degraded = null
  let retryAfter
  if (!provider) degraded = 'no_provider'
  else if (inCooldown()) { degraded = 'rate_limit'; retryAfter = cooldownLeft() }
  else {
    try {
      const out = await interpretWithFallback(provider, text, ctx)
      return { out, provider: provider.name }
    } catch (err) {
      const code = err instanceof VoiceAiError ? err.code : 'unavailable'
      log?.warn({ provider: provider.name, code, status: err?.status, err: err?.message }, 'assistente: errore AI')
      degraded = code
      if (code === 'rate_limit') { startCooldown(err.retryAfter); retryAfter = err.retryAfter || cooldownLeft() }
    }
  }
  const out = await parseAssistantWithRules(text)
  if (out.calls.length) return { out, provider: provider?.name || null, degraded, retryAfter }
  const status = degraded === 'rate_limit' ? 429 : 503
  const code = degraded === 'rate_limit' ? 'ai_rate_limit' : degraded === 'unavailable' ? 'ai_unavailable' : 'ai_not_configured'
  return { failure: { status, code, error: (MESSAGES[degraded] || MESSAGES.unavailable)(retryAfter), ...(retryAfter ? { retryAfter } : {}) } }
}
