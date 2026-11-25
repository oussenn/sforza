import Anthropic from '@anthropic-ai/sdk'
import { AI_PROVIDER_LABELS, AI_PROVIDERS, type AiProviderId, type AiSettingsView } from '@shared/types'
import { AiError, aiStatus, type AccountAi } from './ai'
import { secretConfigured } from './auth'
import * as db from './db'

/**
 * An account's own AI: its Anthropic, OpenAI and Google Gemini API keys and its model choice. The keys are stored encrypted
 * (AES-GCM with a key derived from SESSION_SECRET for this account, the account name bound in as associated data),
 * never logged, never returned to the browser or an agent: the editor only sees whether a key is set, its last four
 * characters and the result of the last check. Changing SESSION_SECRET makes the stored keys unreadable: they then
 * count as missing and the settings page asks for them again.
 */

interface StoredKey {
  iv: string
  enc: string
  hint: string
  checkedAt: string | null
  ok: boolean | null
  error: string | null
}

interface StoredAi {
  mode: 'auto' | 'manual'
  provider: AiProviderId
  model: string
  keys: Partial<Record<AiProviderId, StoredKey>>
}

const encoder = new TextEncoder()
const b64 = (bytes: ArrayBuffer | Uint8Array) => {
  let bin = ''
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b)
  return btoa(bin)
}
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

async function cipherKey(env: { SESSION_SECRET?: string }, owner: string): Promise<CryptoKey> {
  if (!secretConfigured(env)) throw new AiError('The server has no SESSION_SECRET, so API keys cannot be stored safely.')
  const base = await crypto.subtle.importKey('raw', encoder.encode(env.SESSION_SECRET), 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: encoder.encode('sforza-ai-keys-v1'), info: encoder.encode(owner) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function sealKey(env: { SESSION_SECRET?: string }, owner: string, plain: string): Promise<{ iv: string; enc: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(owner) }, await cipherKey(env, owner), encoder.encode(plain))
  return { iv: b64(iv), enc: b64(enc) }
}

/** The plain key, or null when it cannot be read (another account's data, a changed SESSION_SECRET). */
export async function openKey(env: { SESSION_SECRET?: string }, owner: string, sealed: { iv: string; enc: string }): Promise<string | null> {
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: unb64(sealed.iv), additionalData: encoder.encode(owner) },
      await cipherKey(env, owner),
      unb64(sealed.enc),
    )
    return new TextDecoder().decode(plain)
  } catch {
    return null
  }
}

const KEY_SHAPE: Record<AiProviderId, RegExp> = {
  anthropic: /^sk-ant-[A-Za-z0-9_-]{20,300}$/,
  openai: /^sk-(?!ant-)[A-Za-z0-9_-]{20,300}$/,
  // Google's keys have no fixed shape any more (standard "AIza…" keys and the newer auth keys): any long token.
  gemini: /^(?!sk-)[A-Za-z0-9._-]{30,300}$/,
}
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{1,80}$/

const hintOf = (provider: AiProviderId, key: string) => `${AI_PROVIDER_LABELS[provider].keyPrefix}…${key.slice(-4)}`

function parse(raw: string | null): StoredAi {
  const v = (raw ? (JSON.parse(raw) as Partial<StoredAi>) : {}) ?? {}
  return {
    mode: v.mode === 'manual' ? 'manual' : 'auto',
    provider: (AI_PROVIDERS as readonly string[]).includes(v.provider ?? '') ? (v.provider as AiProviderId) : 'anthropic',
    model: typeof v.model === 'string' && MODEL_ID.test(v.model) ? v.model : '',
    keys: Object.fromEntries(AI_PROVIDERS.flatMap((p) => (v.keys?.[p]?.enc && v.keys[p]!.iv ? [[p, v.keys[p]!]] : []))) as StoredAi['keys'],
  }
}

/** The account's keys (decrypted) and model choice for the AI calls of this request; null when it has no key. */
export async function accountAi(env: Env & db.Store): Promise<AccountAi | null> {
  const raw = await db.getAiSettingsRaw(env).catch(() => null)
  if (!raw) return null
  const stored = parse(raw)
  const owner = db.ownerOf(env)
  const keys: Partial<Record<AiProviderId, string>> = {}
  for (const p of AI_PROVIDERS) {
    const sealed = stored.keys[p]
    const plain = sealed ? await openKey(env, owner, sealed) : null
    if (plain) keys[p] = plain
  }
  if (!AI_PROVIDERS.some((p) => keys[p])) return null
  return { ...keys, mode: stored.mode, provider: stored.provider, model: stored.model }
}

/** Checks a key against the provider's model list: free, no tokens used. ok null: the check itself could not run. */
async function checkKey(provider: AiProviderId, key: string): Promise<{ ok: boolean | null; error: string | null }> {
  if (provider === 'anthropic') {
    try {
      await new Anthropic({ apiKey: key, maxRetries: 0, timeout: 15_000 }).models.list({ limit: 1 })
      return { ok: true, error: null }
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) return { ok: false, error: 'The key was rejected: it is wrong or was revoked.' }
      if (err instanceof Anthropic.PermissionDeniedError) return { ok: false, error: 'This key has no permission to use the API.' }
      if (err instanceof Anthropic.RateLimitError) return { ok: null, error: 'Rate limit reached while checking; the key was saved.' }
      if (err instanceof Anthropic.APIError) return { ok: null, error: `The check failed (${err.status ?? 'no answer'}); the key was saved.` }
      return { ok: null, error: 'Could not reach the provider to check the key; it was saved.' }
    }
  }
  if (provider === 'gemini') return checkGeminiKey(key)
  const res = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) }).catch(() => null)
  if (!res) return { ok: null, error: 'Could not reach the provider to check the key; it was saved.' }
  await res.body?.cancel().catch(() => undefined)
  if (res.ok) return { ok: true, error: null }
  if (res.status === 401) return { ok: false, error: 'The key was rejected: it is wrong or was revoked.' }
  if (res.status === 403) return { ok: false, error: 'This key has no permission to use the API.' }
  if (res.status === 429) return { ok: null, error: 'Rate limit or quota reached while checking; the key was saved.' }
  return { ok: null, error: `The check failed (${res.status}); the key was saved.` }
}

/** Google answers a wrong key with 400 API_KEY_INVALID (or 401), a key without access with 403. */
async function checkGeminiKey(key: string): Promise<{ ok: boolean | null; error: string | null }> {
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', {
    headers: { 'x-goog-api-key': key },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null)
  if (!res) return { ok: null, error: 'Could not reach the provider to check the key; it was saved.' }
  const body = (await res.json().catch(() => null)) as { error?: { message?: string; details?: { reason?: string }[] } } | null
  if (res.ok) return { ok: true, error: null }
  const reason = (body?.error?.details ?? []).map((d) => d.reason).join(' ')
  if (res.status === 401 || /API_KEY_INVALID/.test(reason) || (res.status === 400 && /api key/i.test(body?.error?.message ?? '')))
    return { ok: false, error: 'The key was rejected: it is wrong or was revoked.' }
  if (res.status === 403) return { ok: false, error: 'This key may not use the Gemini API (Google refuses unrestricted keys: limit it to the Gemini API in Google AI Studio).' }
  if (res.status === 429) return { ok: null, error: 'Rate limit or quota reached while checking; the key was saved.' }
  return { ok: null, error: `The check failed (${res.status}); the key was saved.` }
}

/** The settings as the editor shows them, with what the AI buttons use now. */
export async function aiSettingsView(env: Env & db.Store): Promise<AiSettingsView> {
  const stored = parse(await db.getAiSettingsRaw(env))
  const account = await accountAi(env)
  const owner = db.ownerOf(env)
  const keys = {} as AiSettingsView['keys']
  for (const p of AI_PROVIDERS) {
    const k = stored.keys[p]
    // A key that no longer opens (SESSION_SECRET changed) counts as missing.
    const readable = k ? (await openKey(env, owner, k)) !== null : false
    keys[p] = k
      ? { set: readable, hint: k.hint, checkedAt: k.checkedAt, ok: readable ? k.ok : false, error: readable ? k.error : 'The saved key can no longer be read: enter it again.' }
      : { set: false, hint: '', checkedAt: null, ok: null, error: null }
  }
  return { keys, mode: stored.mode, provider: stored.provider, model: stored.model, active: aiStatus({ ...env, ACCOUNT_AI: account }) }
}

export interface AiSettingsInput {
  /** a new key sets it, null removes it, a missing provider keeps what is stored */
  keys?: Partial<Record<AiProviderId, string | null>>
  mode?: unknown
  provider?: unknown
  model?: unknown
}

/** Saves keys (checked first: a rejected key is not saved) and the model choice. */
export async function updateAiSettings(env: Env & db.Store, input: AiSettingsInput): Promise<AiSettingsView> {
  const stored = parse(await db.getAiSettingsRaw(env))
  const owner = db.ownerOf(env)
  for (const p of AI_PROVIDERS) {
    const given = input.keys?.[p]
    if (given === undefined) continue
    if (given === null || given === '') {
      delete stored.keys[p]
      continue
    }
    const key = String(given).trim()
    if (!KEY_SHAPE[p].test(key)) {
      const { name, keyPrefix } = AI_PROVIDER_LABELS[p]
      throw new AiError(`That does not look like ${/^[AEIOU]/.test(name) ? 'an' : 'a'} ${name} API key${keyPrefix ? ` (they start with ${keyPrefix})` : ''}.`)
    }
    const check = await checkKey(p, key)
    if (check.ok === false) throw new AiError(`${AI_PROVIDER_LABELS[p].name}: ${check.error}`)
    stored.keys[p] = { ...(await sealKey(env, owner, key)), hint: hintOf(p, key), checkedAt: new Date().toISOString(), ...check }
  }
  if (input.mode === 'auto' || input.mode === 'manual') stored.mode = input.mode
  if ((AI_PROVIDERS as readonly unknown[]).includes(input.provider)) stored.provider = input.provider as AiProviderId
  if (typeof input.model === 'string') {
    const model = input.model.trim()
    if (model && !MODEL_ID.test(model)) throw new AiError('That model id has characters a model id cannot have.')
    stored.model = model
  }
  await db.saveAiSettingsRaw(env, JSON.stringify(stored))
  return aiSettingsView(env)
}

/** Checks the stored key of one provider again and records the result. */
export async function recheckKey(env: Env & db.Store, provider: AiProviderId): Promise<AiSettingsView> {
  const stored = parse(await db.getAiSettingsRaw(env))
  const sealed = stored.keys[provider]
  const key = sealed ? await openKey(env, db.ownerOf(env), sealed) : null
  if (!sealed || !key) throw new AiError(`No ${AI_PROVIDER_LABELS[provider].name} key is saved.`)
  stored.keys[provider] = { ...sealed, checkedAt: new Date().toISOString(), ...(await checkKey(provider, key)) }
  await db.saveAiSettingsRaw(env, JSON.stringify(stored))
  return aiSettingsView(env)
}
