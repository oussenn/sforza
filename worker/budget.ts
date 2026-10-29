import type { AiSpend } from '@shared/types'
import { AiError, type Usage } from './ai'

/**
 * Spending cap for paid models (OpenAI, Claude): every call's cost is recorded per UTC day in D1, and new
 * calls are refused once today's or this month's total reaches AI_DAILY_BUDGET_USD / AI_MONTHLY_BUDGET_USD.
 * The free Workers AI model is not counted.
 */

/** $ per million tokens [input, output]; reasoning tokens are billed as output. */
const PRICES: Record<string, [number, number]> = {
  'gpt-5.6-luna': [0.2, 1.2],
  'gpt-5.6-terra': [2, 12],
  'gpt-5.6-sol': [4, 20],
  'gpt-5.4-mini': [0.75, 4.5],
  'gpt-5.4-nano': [0.2, 1.25],
}
/** Models missing from the table are counted at this deliberately high rate, so the cap errs on the safe side. */
const UNKNOWN_PRICE: [number, number] = [5, 25]

export function costOf(usage: Usage): number {
  if (usage.provider === 'workers-ai') return 0
  const [input, output] = PRICES[usage.model.replace(/-\d{4}-\d{2}-\d{2}$/, '')] ?? UNKNOWN_PRICE
  return (usage.input * input + usage.output * output) / 1_000_000
}

const limit = (value: string | undefined, fallback: number) => {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

const today = () => new Date().toISOString().slice(0, 10)

export async function aiSpend(env: Env): Promise<AiSpend | null> {
  // The benchmark worker has no database: no cap there.
  if (!env.DB) return null
  const day = today()
  const row = await env.DB.prepare(
    'SELECT COALESCE(SUM(CASE WHEN day = ? THEN usd END), 0) AS today, COALESCE(SUM(usd), 0) AS month FROM ai_spend WHERE day >= ?',
  )
    .bind(day, `${day.slice(0, 7)}-01`)
    .first<{ today: number; month: number }>()
  return {
    today: row?.today ?? 0,
    month: row?.month ?? 0,
    dailyLimit: limit(env.AI_DAILY_BUDGET_USD, 0.25),
    monthlyLimit: limit(env.AI_MONTHLY_BUDGET_USD, 1),
  }
}

/** Throws when a paid call would go over the budget. */
export async function checkBudget(env: Env): Promise<void> {
  const spend = await aiSpend(env)
  if (!spend) return
  const $ = (n: number) => `$${n.toFixed(2)}`
  if (spend.today >= spend.dailyLimit) {
    throw new AiError(`Daily AI budget reached (${$(spend.today)} of ${$(spend.dailyLimit)} spent today). It resets at midnight UTC.`)
  }
  if (spend.month >= spend.monthlyLimit) {
    throw new AiError(
      `Monthly AI budget reached (${$(spend.month)} of ${$(spend.monthlyLimit)}). Raise AI_MONTHLY_BUDGET_USD in wrangler.jsonc to continue.`,
    )
  }
}

export async function recordSpend(env: Env, usage: Usage[]): Promise<void> {
  const usd = usage.reduce((sum, u) => sum + costOf(u), 0)
  if (!env.DB || usd <= 0) return
  await env.DB.prepare(
    'INSERT INTO ai_spend (day, usd, calls) VALUES (?, ?, 1) ON CONFLICT(day) DO UPDATE SET usd = usd + excluded.usd, calls = calls + 1',
  )
    .bind(today(), usd)
    .run()
    .catch((err: unknown) => console.error('Could not record AI spend', err))
}
