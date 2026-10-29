import { cn } from '@/lib/utils'

/** red < 30 ≤ orange < 60 ≤ lime < 80 ≤ green */
export const SCORE_TIERS = [
  { min: 80, color: '#16a34a', label: '80+' },
  { min: 60, color: '#65a30d', label: '60–79' },
  { min: 30, color: '#ea580c', label: '30–59' },
  { min: 0, color: '#dc2626', label: '< 30' },
] as const

export function scoreColor(value: number | null | undefined): string {
  if (value == null) return '#a3a3a3'
  return SCORE_TIERS.find((t) => value >= t.min)?.color ?? '#dc2626'
}

/** A percentage inside a progress ring, coloured by tier. */
export function ScoreRing({
  value,
  size = 40,
  stroke = 3.5,
  label,
  title,
  className,
}: {
  value: number | null | undefined
  size?: number
  stroke?: number
  label?: string
  title?: string
  className?: string
}) {
  const r = (size - stroke) / 2
  const circumference = 2 * Math.PI * r
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value))
  const color = scoreColor(value)
  return (
    <div className={cn('flex flex-col items-center gap-1', className)} title={title}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90" aria-hidden>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" className="stroke-border" strokeWidth={stroke} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - pct / 100)}
            className="transition-[stroke-dashoffset] duration-500"
          />
        </svg>
        <span
          className="absolute inset-0 grid place-items-center font-semibold tracking-tight tabular-nums"
          style={{ fontSize: Math.max(9, size * 0.27), color }}
        >
          {value == null ? '–' : `${Math.round(value)}%`}
        </span>
      </div>
      {label && <span className="text-muted-foreground text-[11px] leading-none">{label}</span>}
    </div>
  )
}
