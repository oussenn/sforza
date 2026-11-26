import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, X } from 'lucide-react'
import { Logo } from '@/components/Logo'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { KnowledgeRing } from './profile/KnowledgeStrength'
import { useKnowledgeScore } from './profile/useKnowledgeScore'
import { navigate } from './router'
import { useSession } from './session'

/**
 * The welcome tour: a card for each part of the app, next to the part it is about, which stays sharp while the rest
 * of the page is blurred. Back, Next and Skip (also the arrow keys and Escape). It shows once per account; finishing
 * or skipping it is stored on the server, and the menu and Ctrl+K bring it back.
 */

interface Step {
  /** the element the card points at ([data-tour] attribute); none: the card sits in the middle */
  target?: string
  /** a page to open first */
  page?: () => void
  title: string
  body: (ctx: { score: number | null; admin: boolean }) => ReactNode
}

const STEPS: Step[] = [
  {
    title: 'Welcome to Sforza',
    body: () => (
      <>
        Your CVs, cover letters and job applications in one place, each tailored to the job. This tour takes a minute: Next and Back move through it, Skip
        ends it, and the menu brings it back any time.
      </>
    ),
  },
  {
    target: 'nav-knowledge',
    title: 'Start with your knowledge base',
    body: () => (
      <>
        Everything Sforza knows about you beyond your master CV: projects, skills, experience, certificates and notes.{' '}
        <strong>Every tailored CV and letter is built only from these two</strong>, so a full, well structured knowledge base means better results. The line
        around this button fills from red to green as it grows.
      </>
    ),
  },
  {
    target: 'kb-score',
    page: () => navigate({ page: 'knowledge' }),
    title: 'Your knowledge score',
    body: ({ score }) => (
      <>
        Each part has a minimum for good tailoring: 3 described roles, 6 projects, 20 skills, 8 results with figures, your degree and languages, and some
        notes. The next steps show what adds the most.{score != null && <> Yours is at {score} now.</>}
      </>
    ),
  },
  {
    target: 'nav-cvs',
    title: 'My CVs',
    body: () => (
      <>
        Your master CV holds your whole story in the design you like. Each job gets a tailored copy made from it, in English, French or German, always on one
        full page.
      </>
    ),
  },
  {
    target: 'nav-applications',
    page: () => navigate({ page: 'applications', appId: null }),
    title: 'Your applications board',
    body: () => (
      <>
        Paste a job link to add a card with the company logo, and move it from Saved to Offer as things happen (on a phone: hold a card, then drag it). Drafts
        made by you or your agent land in Draft.
      </>
    ),
  },
  {
    target: 'nav-letters',
    title: 'Cover letters',
    body: () => <>Every card can hold a letter in each language, in the design of its CV. Write it yourself, or let the AI write it from the posting and your knowledge base.</>,
  },
  {
    target: 'nav-jobsearch',
    title: 'Job search',
    body: () => <>Tell Sforza what you look for: roles, places, job types and languages. Searches and drafts follow it.</>,
  },
  {
    target: 'nav-mcp',
    title: 'Work with your AI agent',
    body: () => (
      <>
        Connect Claude, ChatGPT or any MCP client with your own connector address. Your agent can find jobs, tailor CVs and write letters, always as drafts:
        you send every application yourself.
      </>
    ),
  },
  {
    target: 'nav-ai',
    title: 'AI models',
    body: () => <>Add your own API key (Anthropic, OpenAI or Google) for the AI buttons in the app, and pick the model.</>,
  },
  {
    target: 'menu',
    title: 'Themes, account and this tour',
    body: ({ admin }) => (
      <>
        Light and dark, the themes, your password and this tour live in this menu. Ctrl+K (⌘K on a Mac) opens any CV, card or page.
        {admin && <> People who ask for access wait under Account, where you send each one an invitation by mail.</>}
      </>
    ),
  },
  {
    title: 'You are set',
    body: () => <>The best first step: fill your knowledge base until its line turns green. Then paste a job link on the board and let Sforza tailor the rest.</>,
  },
]

const PAD = 6
const RADIUS = 12
const GAP = 14

type Box = { left: number; top: number; width: number; height: number }

/** The nearest ancestor that scrolls, to make room for the card above a tall target. */
function scroller(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const y = getComputedStyle(p).overflowY
    if ((y === 'auto' || y === 'scroll') && p.scrollHeight > p.clientHeight) return p
  }
  return null
}

/** The target's box on screen, followed through resizes and scrolling; null while it is not there (or no target). */
function useTargetBox(target: string | undefined, step: number): { box: Box | null; el: HTMLElement | null } {
  const [box, setBox] = useState<Box | null>(null)
  const [found, setFound] = useState<HTMLElement | null>(null)
  useEffect(() => {
    setBox(null)
    setFound(null)
    if (!target) return
    let el: HTMLElement | null = null
    let frame = 0
    let tries = 0
    let ro: ResizeObserver | null = null
    const measure = () => {
      if (!el) return
      const r = el.getBoundingClientRect()
      setBox(r.width || r.height ? { left: r.left, top: r.top, width: r.width, height: r.height } : null)
    }
    // The page of a step may still be loading: look for the element for up to two seconds.
    const find = () => {
      el = [...document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`)].find((e) => e.offsetParent !== null || e.getClientRects().length) ?? null
      if (!el) {
        if (++tries < 120) frame = requestAnimationFrame(find)
        return
      }
      const r = el.getBoundingClientRect()
      if (r.top < 0 || r.bottom > window.innerHeight) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      ro = new ResizeObserver(measure)
      ro.observe(el)
      setFound(el)
      measure()
    }
    find()
    const follow = () => measure()
    window.addEventListener('resize', follow)
    window.addEventListener('scroll', follow, true)
    return () => {
      cancelAnimationFrame(frame)
      ro?.disconnect()
      window.removeEventListener('resize', follow)
      window.removeEventListener('scroll', follow, true)
    }
  }, [target, step])
  return { box, el: found }
}

/** The overlay's outline with a rounded hole around the target (even-odd fill: the hole stays clear). */
function holePath(b: Box): string {
  const w = window.innerWidth
  const h = window.innerHeight
  const x = b.left - PAD
  const y = b.top - PAD
  const bw = b.width + PAD * 2
  const bh = b.height + PAD * 2
  const r = Math.min(RADIUS, bw / 2, bh / 2)
  return `M0 0H${w}V${h}H0Z M${x + r} ${y}H${x + bw - r}A${r} ${r} 0 0 1 ${x + bw} ${y + r}V${y + bh - r}A${r} ${r} 0 0 1 ${x + bw - r} ${y + bh}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + bh - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`
}

export default function Tour() {
  const [index, setIndex] = useState(0)
  const step = STEPS[index]
  const admin = useSession((s) => s.admin)
  const kb = useKnowledgeScore()
  const { box, el: targetEl } = useTargetBox(step.target, index)
  const card = useRef<HTMLDivElement>(null)
  const next = useRef<HTMLButtonElement>(null)
  const [place, setPlace] = useState<{ left: number; top: number; arrow: 'up' | 'down' | null; arrowX: number } | null>(null)
  const last = index === STEPS.length - 1

  const end = useCallback(() => {
    useSession.setState({ touring: false, tourSeen: true })
    void api.setTourSeen(true).catch(() => undefined)
  }, [])
  const go = useCallback(
    (to: number) => {
      if (to < 0) return
      if (to >= STEPS.length) return end()
      STEPS[to].page?.()
      setIndex(to)
    },
    [end],
  )

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') end()
      else if (e.key === 'ArrowRight') go(index + 1)
      else if (e.key === 'ArrowLeft') go(index - 1)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [index, go, end])

  useEffect(() => next.current?.focus({ preventScroll: true }), [index])

  // The card below its target when there is room, else above; in the middle without a target.
  useLayoutEffect(() => {
    const el = card.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight
    if (!box) return setPlace({ left: (vw - w) / 2, top: Math.max(12, (vh - h) / 2), arrow: null, arrowX: 0 })
    const centre = box.left + box.width / 2
    const left = Math.max(12, Math.min(vw - w - 12, centre - w / 2))
    const below = box.top + box.height + PAD + GAP
    const fitsBelow = below + h <= vh - 12
    const above = box.top - PAD - GAP - h
    // A target too tall for the card on either side: scroll it down until the card fits above it (once).
    if (!fitsBelow && above < 12 && targetEl) {
      const area = scroller(targetEl)
      const shift = 12 - above
      if (area && area.scrollTop > 0) {
        area.scrollBy({ top: -Math.min(shift, area.scrollTop) })
        return
      }
    }
    const top = fitsBelow ? below : Math.max(12, above)
    setPlace({ left, top, arrow: fitsBelow ? 'up' : 'down', arrowX: Math.max(18, Math.min(w - 18, centre - left)) })
  }, [box, index])

  return (
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[3px] transition-[clip-path] duration-300"
        style={{ clipPath: box ? `path(evenodd, '${holePath(box)}')` : undefined }}
      />
      {box && (
        <div
          aria-hidden
          className="ring-primary pointer-events-none absolute rounded-xl ring-2 transition-all duration-300 ease-out"
          style={{
            left: box.left - PAD,
            top: box.top - PAD,
            width: box.width + PAD * 2,
            height: box.height + PAD * 2,
            boxShadow: '0 0 0 4px color-mix(in oklch, var(--primary) 25%, transparent), 0 0 30px color-mix(in oklch, var(--primary) 35%, transparent)',
          }}
        />
      )}
      <div
        ref={card}
        className={cn(
          'bg-popover text-popover-foreground ring-hairline absolute w-[min(380px,calc(100vw-24px))] rounded-2xl p-5 shadow-2xl ring-1 transition-[left,top,opacity] duration-300 ease-out',
          !place && 'opacity-0',
        )}
        style={place ? { left: place.left, top: place.top } : { left: 0, top: 0 }}
      >
        {place?.arrow && (
          <span
            aria-hidden
            className={cn('bg-popover ring-hairline absolute size-3 rotate-45', place.arrow === 'up' ? '-top-1.5 [clip-path:polygon(0_0,100%_0,0_100%)]' : '-bottom-1.5 [clip-path:polygon(100%_0,100%_100%,0_100%)]')}
            style={{ left: place.arrowX - 6 }}
          />
        )}
        <div key={index} className="animate-in fade-in slide-in-from-bottom-1 duration-200">
          <div className="mb-3 flex items-center gap-3">
            {index === 0 || last ? (
              <Logo className="size-10" />
            ) : step.target === 'kb-score' || step.target === 'nav-knowledge' ? (
              kb && <KnowledgeRing score={kb.score} size={40} stroke={4} compact />
            ) : null}
            <div className="min-w-0 flex-1">
              <p className="text-muted-foreground text-xs font-medium tabular-nums">
                {index + 1} of {STEPS.length}
              </p>
              <h2 id="tour-title" className="text-base leading-snug font-semibold">
                {step.title}
              </h2>
            </div>
            <button type="button" onClick={end} className="text-muted-foreground hover:text-foreground -mt-6 -mr-2 rounded-md p-1" aria-label="Skip the tour">
              <X className="size-4" />
            </button>
          </div>
          <p className="text-muted-foreground text-sm leading-relaxed [&_strong]:text-foreground [&_strong]:font-semibold">{step.body({ score: kb?.score ?? null, admin })}</p>
        </div>
        <div className="mt-4 flex items-center gap-1" aria-hidden>
          {STEPS.map((_, i) => (
            <span key={i} className={cn('h-1 rounded-full transition-all duration-300', i === index ? 'bg-primary w-5' : i < index ? 'bg-primary/50 w-1.5' : 'bg-foreground/15 w-1.5')} />
          ))}
        </div>
        <div className="mt-4 flex items-center gap-2">
          {!last && (
            <Button variant="ghost" size="sm" onClick={end} className="text-muted-foreground -ml-2">
              Skip
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            {index > 0 && (
              <Button variant="outline" size="sm" onClick={() => go(index - 1)}>
                <ArrowLeft /> Back
              </Button>
            )}
            {last ? (
              <>
                <Button variant="outline" size="sm" onClick={end}>
                  Done
                </Button>
                <Button
                  ref={next}
                  size="sm"
                  onClick={() => {
                    navigate({ page: 'knowledge' })
                    end()
                  }}
                >
                  Fill my knowledge base <ArrowRight />
                </Button>
              </>
            ) : (
              <Button ref={next} size="sm" onClick={() => go(index + 1)}>
                {index === 0 ? 'Show me' : 'Next'} <ArrowRight />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
