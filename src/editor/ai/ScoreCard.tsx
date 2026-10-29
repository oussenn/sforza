import { useState } from 'react'
import { Check, ChevronRight, CircleHelp, Loader2, Minus, RefreshCw, X } from 'lucide-react'
import type { JobAnalysis, JobRequirement, MatchScore, RequirementResult, ScoreDimension, Verdict } from '@shared/types'
import { REQ_CATEGORIES, SCORE_DIMENSIONS } from '@shared/types'
import { ScoreRing, SCORE_TIERS } from '@/components/ScoreRing'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const DIMENSION_LABELS: Record<ScoreDimension, string> = {
  skills: 'Skills',
  experience: 'Experience',
  seniority: 'Seniority',
  education: 'Education',
  languages: 'Languages',
  location: 'Location',
  keywords: 'Keywords',
}

const DIMENSION_HELP: Record<ScoreDimension, string> = {
  skills: 'Tools, technologies and methods the posting asks for',
  experience: 'Tasks, roles and industries you have worked in',
  seniority: 'Years of experience and career level',
  education: 'Degree, enrolment, certifications',
  languages: 'Spoken languages and levels',
  location: 'Workplace, on-site days, relocation',
  keywords: 'Posting terms an ATS search finds on this CV',
}

const VERDICT_STYLE: Record<Verdict, { icon: typeof Check; className: string; label: string }> = {
  met: { icon: Check, className: 'bg-green-600 text-white', label: 'Met' },
  partial: { icon: Minus, className: 'bg-orange-500 text-white', label: 'Partly' },
  missing: { icon: X, className: 'bg-red-600 text-white', label: 'Missing' },
  unknown: { icon: CircleHelp, className: 'bg-neutral-300 text-white dark:bg-neutral-600', label: 'Not on a CV' },
}

export function Disclosure({ title, children, defaultOpen = false }: { title: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-1 py-1 text-left text-sm font-medium">
        <ChevronRight className={cn('text-muted-foreground size-4 transition-transform', open && 'rotate-90')} />
        {title}
      </button>
      {open && <div className="mt-1">{children}</div>}
    </div>
  )
}

/** The posting's requirements, with verdicts when a CV was scored. */
export function RequirementList({ analysis, results }: { analysis: JobAnalysis; results?: RequirementResult[] }) {
  const byId = new Map(results?.map((r) => [r.id, r]))
  return (
    <div className="grid gap-3">
      {REQ_CATEGORIES.map((category) => {
        const reqs = analysis.requirements
          .filter((r) => r.category === category)
          .sort((a, b) => Number(b.importance === 'must') - Number(a.importance === 'must'))
        if (!reqs.length) return null
        return (
          <div key={category}>
            <div className="text-muted-foreground mb-1 text-[11px] font-semibold tracking-wide uppercase">{DIMENSION_LABELS[category]}</div>
            <ul className="grid gap-1.5">
              {reqs.map((req) => (
                <RequirementRow key={req.id} req={req} result={byId.get(req.id)} />
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}

function RequirementRow({ req, result }: { req: JobRequirement; result?: RequirementResult }) {
  const style = result ? VERDICT_STYLE[result.verdict] : null
  const Icon = style?.icon
  return (
    <li className="flex items-start gap-2 text-sm">
      {style && Icon ? (
        <span title={style.label} className={cn('mt-0.5 grid size-4 shrink-0 place-items-center rounded-full', style.className)}>
          <Icon className="size-3" strokeWidth={3} />
        </span>
      ) : (
        <span className="bg-muted-foreground/60 mt-1.5 size-1.5 shrink-0 rounded-full" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-1.5">
          <span className={cn(req.importance === 'nice' && 'text-foreground/75')}>{req.text}</span>
          {req.knockout ? (
            <span className="bg-primary text-primary-foreground rounded px-1 text-[10px] font-semibold uppercase" title="Hard requirement: applications without it are usually filtered out">
              must
            </span>
          ) : req.importance === 'nice' ? (
            <span className="text-muted-foreground rounded border px-1 text-[10px] uppercase">plus</span>
          ) : null}
        </div>
        {result && (result.reason || result.evidence) && (
          <p className="text-muted-foreground text-xs">
            {result.reason}
            {result.evidence && <span className="text-muted-foreground/80"> · “{result.evidence}”</span>}
          </p>
        )}
      </div>
    </li>
  )
}

export function ScoreCard({
  score,
  analysis,
  subject,
  stale,
  busy,
  progress,
  onRescore,
}: {
  score: MatchScore
  analysis: JobAnalysis
  /** e.g. "Master CV" */
  subject?: string
  stale?: boolean
  busy?: boolean
  progress?: string | null
  onRescore?: () => void
}) {
  const dims = SCORE_DIMENSIONS.filter((d) => score.dimensions[d] != null)
  const found = score.keywords.filter((k) => k.found).length
  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-4">
        <ScoreRing value={score.overall} size={64} stroke={5} />
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{subject ? `${subject}: match score` : 'Match score'}</div>
          <p className="text-muted-foreground text-xs">
            {score.lang.toUpperCase()} version · {analysis.requirements.length} requirements · {score.model}
          </p>
          {score.cap && <p className="mt-0.5 text-xs font-medium text-red-700 dark:text-red-400">Capped at {score.cap.value}%: {score.cap.reason}</p>}
          {stale && <p className="mt-0.5 text-xs font-medium text-orange-700 dark:text-orange-400">The CV changed since this score.</p>}
        </div>
        {onRescore && (
          <Button variant="outline" size="sm" onClick={onRescore} disabled={busy} className="shrink-0">
            {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {busy ? progress || 'Scoring…' : 'Re-score'}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap justify-between gap-y-3">
        {dims.map((d) => (
          <ScoreRing key={d} value={score.dimensions[d]} label={DIMENSION_LABELS[d]} title={DIMENSION_HELP[d]} className="w-15.5" />
        ))}
      </div>

      <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        {[...SCORE_TIERS].reverse().map((t) => (
          <span key={t.label} className="flex items-center gap-1">
            <span className="size-2 rounded-full" style={{ background: t.color }} />
            {t.label}
          </span>
        ))}
        <span className="ml-auto" title="Education and languages count 0.8×, location 0.5×. A missing hard requirement caps the score.">
          Overall: requirements met (must-haves 3×) + 10% keywords
        </span>
      </div>

      <div className="grid gap-1 border-t pt-2">
        <Disclosure title={`Requirements (${score.requirements.filter((r) => r.verdict === 'met').length}/${analysis.requirements.length} met)`}>
          <RequirementList analysis={analysis} results={score.requirements} />
        </Disclosure>
        {score.keywords.length > 0 && (
          <Disclosure title={`ATS keywords (${found}/${score.keywords.length} on the CV)`}>
            <div className="flex flex-wrap gap-1.5">
              {score.keywords.map((k) => (
                <span
                  key={k.term}
                  className={cn(
                    'rounded-full px-2 py-0.5 text-xs',
                    k.found
                      ? 'bg-green-50 text-green-800 ring-1 ring-green-200 dark:bg-green-950/40 dark:text-green-300 dark:ring-green-900'
                      : 'bg-red-50 text-red-700 ring-1 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900',
                  )}
                >
                  {k.found ? '✓' : '✕'} {k.term}
                </span>
              ))}
            </div>
          </Disclosure>
        )}
      </div>
    </div>
  )
}
