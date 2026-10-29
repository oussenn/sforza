import type { BuiltinStage, Stage } from '@shared/types'
import { isCustomStage, stageLabel } from '@shared/utils'
import { cn } from '@/lib/utils'
import { useApplications } from './store'

const STAGE_DOT: Record<BuiltinStage, string> = {
  saved: 'bg-neutral-400 dark:bg-neutral-500',
  draft: 'bg-violet-500',
  applied: 'bg-sky-500',
  interview: 'bg-amber-500',
  offer: 'bg-green-600 dark:bg-green-500',
  rejected: 'bg-red-500',
}

/** Dot colour of a stage; columns the user added share one colour. */
export function stageDot(stage: Stage): string {
  return isCustomStage(stage) ? 'bg-teal-500' : STAGE_DOT[stage]
}

/** Label of a stage, including the board's own columns. */
export function useStageLabel(): (stage: Stage) => string {
  const columns = useApplications((s) => s.columns)
  return (stage) => stageLabel(stage, columns)
}

export function StageBadge({ stage, className }: { stage: Stage; className?: string }) {
  const label = useStageLabel()
  return (
    <span className={cn('bg-muted inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium', className)}>
      <span className={cn('size-1.5 rounded-full', stageDot(stage))} />
      {label(stage)}
    </span>
  )
}

/** "12 Sep", or "12 Sep 2025" outside the current year. */
export function shortDate(value: string): string {
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value)
  if (Number.isNaN(date.getTime())) return value
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: sameYear ? undefined : 'numeric' })
}

/** Days from today to a YYYY-MM-DD date (negative = past). */
export function daysUntil(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [y, m, d] = value.split('-').map(Number)
  const now = new Date()
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86_400_000)
}
