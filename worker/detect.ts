import { AiError } from './ai'

/**
 * Optional AI-text detection with AI or Not (free plan: 1M words a month, API key at aiornot.com), set as the
 * AIORNOT_API_KEY secret. Without it, Claude checks the documents in a browser detector and records the result.
 */

const DETECTOR = 'AI or Not'

export const detectorName = (env: Env): string | null => (env.AIORNOT_API_KEY ? DETECTOR : null)

/** Share of the text rated as AI-written, 0–100. */
export async function detectAi(env: Env, text: string): Promise<number> {
  if (!env.AIORNOT_API_KEY) throw new AiError('No AI detector is set up on the server (AIORNOT_API_KEY). Use one in the browser instead.')
  const body = text.trim()
  if (body.length < 250) throw new AiError('The detector needs at least 250 characters of text.')
  // Sent as multipart: their server rejects the URL-encoded form its docs describe ("Invalid boundary").
  const form = new FormData()
  form.append('text', body.slice(0, 100_000))
  const res = await fetch('https://api.aiornot.com/v2/text/sync', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.AIORNOT_API_KEY}`, Accept: 'application/json' },
    body: form,
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null)
  if (!res?.ok) {
    console.warn('AI or Not failed', res?.status, await res?.text().catch(() => ''))
    throw new AiError(`The AI detector did not answer (${res?.status ?? 'network error'}).`)
  }
  const data = (await res.json()) as { report?: { ai_text?: { confidence?: number; is_detected?: boolean } } }
  const result = data.report?.ai_text
  if (typeof result?.confidence !== 'number') throw new AiError('The AI detector sent an unexpected answer.')
  // `confidence` is documented only as "confidence score for AI-generated text detection": read it as the AI
  // probability, unless the verdict is "not AI" with a high confidence, which can only mean confidence in that verdict.
  const ai = result.is_detected === false && result.confidence > 0.5 ? 1 - result.confidence : result.confidence
  return Math.round(Math.min(1, Math.max(0, ai)) * 100)
}
