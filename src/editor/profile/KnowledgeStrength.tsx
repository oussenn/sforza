import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowRight, Briefcase, FolderKanban, GraduationCap, NotebookPen, Sparkles, TrendingUp, Wrench } from 'lucide-react'
import { scoreColor, type KbPartId, type KbScore } from '@shared/kbscore'
import { cn } from '@/lib/utils'
import { navigate, openCv } from '../router'
import { useEditor } from '../store'
import { useKnowledgeScore } from './useKnowledgeScore'

export const PART_ICONS: Record<KbPartId, typeof Briefcase> = {
  experience: Briefcase,
  projects: FolderKanban,
  skills: Wrench,
  results: TrendingUp,
  education: GraduationCap,
  notes: NotebookPen,
}

/** The knowledge base tab where a part grows; education and languages live in the master CV. */
export const PART_TAB: Record<KbPartId, string | null> = {
  experience: 'experience',
  projects: 'projects',
  skills: 'skills',
  results: 'experience',
  education: 'certifications',
  notes: 'notes',
}

/** A ring that fills and colours itself from red to green with the score, the number inside. */
export function KnowledgeRing({ score, size = 104, stroke = 9, compact = false, className }: { score: number; size?: number; stroke?: number; compact?: boolean; className?: string }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  return (
    <div className={cn('relative grid shrink-0 place-items-center', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity={0.1} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={scoreColor(score)}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - score / 100)}
          style={{ transition: 'stroke-dashoffset 700ms cubic-bezier(0.2, 0.8, 0.2, 1), stroke 700ms' }}
        />
      </svg>
      <span className="text-center leading-none">
        <span className={cn('block font-semibold tabular-nums', compact ? 'text-xs' : 'text-2xl')}>{score}</span>
        {!compact && <span className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">of 100</span>}
      </span>
    </div>
  )
}

/**
 * The top of the knowledge base: how full it is, why that matters, what each part needs and what to add next.
 * A part or step opens the tab where it grows (or the master CV for a degree and languages).
 */
export function KnowledgeStrength({ onTab }: { onTab: (tab: string) => void }) {
  const kb = useKnowledgeScore()
  const master = useEditor((s) => s.list.find((m) => m.kind === 'master'))
  if (!kb) return <div className="bg-muted/40 mb-5 h-40 animate-pulse rounded-2xl" />

  const go = (part: KbPartId) => {
    const tab = PART_TAB[part]
    if (part === 'education' && kb.parts.find((p) => p.id === 'education')!.have < 1 && master) return openCv(master.id, 'content')
    if (tab) onTab(tab)
  }

  return (
    <section className="bg-muted/40 ring-hairline mb-5 grid gap-5 rounded-2xl p-4 ring-1 sm:p-5">
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        <KnowledgeRing score={kb.score} />
        <div className="min-w-0 flex-1 text-center sm:text-left">
          <p className="text-xs font-semibold tracking-wide uppercase" style={{ color: scoreColor(kb.score) }}>
            {kb.level.label}
          </p>
          <h3 className="mt-0.5 text-base font-semibold">How well Sforza knows you</h3>
          <p className="text-muted-foreground mt-1 text-sm">
            Every tailored CV and letter is built only from your master CV and this knowledge base. The more it holds, and the clearer each entry (what you
            did, with what, and the result), the better each document fits the job. {kb.level.says}
          </p>
        </div>
      </div>

      {/* The welcome tour points at the parts and next steps. */}
      <div data-tour="kb-score" className="grid gap-5">
      <ul className="grid gap-2 sm:grid-cols-2">
        {kb.parts.map((p) => {
          const Icon = PART_ICONS[p.id]
          const pct = Math.round(p.ratio * 100)
          return (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => go(p.id)}
                className="bg-background ring-hairline hover:ring-foreground/20 grid w-full gap-1.5 rounded-xl p-3 text-left ring-1 transition"
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  <Icon className="text-muted-foreground size-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{p.label}</span>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {Math.min(p.have, 999)} / {p.target}
                  </span>
                </span>
                <span className="bg-foreground/[0.07] h-1.5 overflow-hidden rounded-full">
                  <span className="block h-full rounded-full transition-[width] duration-700" style={{ width: `${pct}%`, background: scoreColor(pct) }} />
                </span>
                <span className="text-muted-foreground text-xs">{p.rule}</span>
              </button>
            </li>
          )
        })}
      </ul>

      {kb.next.length > 0 ? (
        <div className="grid gap-1.5">
          <h4 className="flex items-center gap-1.5 text-sm font-semibold">
            <Sparkles className="size-4" /> Next steps
          </h4>
          {kb.next.slice(0, 3).map((n) => (
            <button
              key={n.part}
              type="button"
              onClick={() => go(n.part)}
              className="hover:bg-background group flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition"
            >
              <span className="min-w-0 flex-1">{n.text}</span>
              <span className="shrink-0 rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums" style={{ color: scoreColor(80), background: 'color-mix(in oklch, currentColor 12%, transparent)' }}>
                +{n.gain}
              </span>
              <ArrowRight className="text-muted-foreground size-3.5 shrink-0 opacity-0 transition group-hover:opacity-100" />
            </button>
          ))}
        </div>
      ) : (
        <p className="text-sm font-medium" style={{ color: scoreColor(100) }}>
          Every part has what good tailoring needs. Keep adding new projects and results as they happen.
        </p>
      )}
      </div>
    </section>
  )
}

/**
 * The contour around the Knowledge base button of the top bar: a line along its edge that runs as far round as
 * the score, from red to green, starting at the top centre.
 */
export function KnowledgeContour({ score }: { score: number }) {
  const ref = useRef<SVGSVGElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = ref.current?.parentElement
    if (!el) return
    const ro = new ResizeObserver(() => setBox({ w: el.offsetWidth, h: el.offsetHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const { w, h } = box
  if (!w || !h) return <svg ref={ref} className="pointer-events-none absolute inset-0" aria-hidden />
  const i = 1
  const r = 8
  const path = `M ${w / 2} ${i} H ${w - r} A ${r - i} ${r - i} 0 0 1 ${w - i} ${r} V ${h - r} A ${r - i} ${r - i} 0 0 1 ${w - r} ${h - i} H ${r} A ${r - i} ${r - i} 0 0 1 ${i} ${h - r} V ${r} A ${r - i} ${r - i} 0 0 1 ${r} ${i} Z`
  return (
    <svg ref={ref} width={w} height={h} className="pointer-events-none absolute inset-0 overflow-visible" aria-hidden>
      <path d={path} fill="none" stroke="currentColor" strokeOpacity={0.12} strokeWidth={1.75} />
      <path
        d={path}
        fill="none"
        stroke={scoreColor(score)}
        strokeWidth={2}
        strokeLinecap="round"
        pathLength={100}
        strokeDasharray={`${Math.max(score, 0.01)} 100`}
        style={{ transition: 'stroke-dasharray 700ms cubic-bezier(0.2, 0.8, 0.2, 1), stroke 700ms' }}
      />
    </svg>
  )
}

/** Moving up a level while filling it in earns a word of thanks (once per level and visit). */
export function useLevelUps(kb: KbScore | null, onUp: (kb: KbScore) => void) {
  const last = useRef<number | null>(null)
  const ORDER = ['start', 'shape', 'good', 'strong', 'excellent']
  useEffect(() => {
    if (!kb) return
    const at = ORDER.indexOf(kb.level.id)
    if (last.current !== null && at > last.current) onUp(kb)
    last.current = Math.max(last.current ?? -1, at)
  }, [kb?.level.id])
}

/** A short line where tailoring starts, while the knowledge base is still thin. */
export function KnowledgeHint({ below = 60, className }: { below?: number; className?: string }) {
  const kb = useKnowledgeScore()
  if (!kb || kb.score >= below) return null
  return (
    <button
      type="button"
      onClick={() => navigate({ page: 'knowledge' })}
      className={cn('ring-hairline hover:ring-foreground/20 flex w-full items-center gap-3 rounded-xl p-3 text-left ring-1 transition', className)}
    >
      <KnowledgeRing score={kb.score} size={38} stroke={4} compact />
      <span className="min-w-0 flex-1 text-xs">
        <span className="block font-medium">Your knowledge base is at {kb.score} of 100</span>
        <span className="text-muted-foreground">Tailoring can only use what is there. {kb.next[0]?.text ?? ''}</span>
      </span>
      <ArrowRight className="text-muted-foreground size-4 shrink-0" />
    </button>
  )
}
