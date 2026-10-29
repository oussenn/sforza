import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Bot, Check, Copy, Library, Search } from 'lucide-react'
import { toast } from 'sonner'
import { CLAUDE_PROMPTS, type ClaudePrompt, type PromptContext } from '@shared/prompts'
import type { DocLangs, GermanLimit, SearchProfile } from '@shared/types'
import { DOC_LANG_LABELS, DOC_LANGS, GERMAN_LIMIT_LABELS, GERMAN_LIMITS, JOB_TYPE_LABELS, JOB_TYPES, WORK_MODES } from '@shared/types'
import { CV_RULES, searchesGermany } from '@shared/utils'
import { InfoTip } from '@/components/InfoTip'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Disclosure } from '../ai/ScoreCard'
import { useEditor } from '../store'
import type { PanelPage } from '../router'
import KnowledgeBase from './KnowledgeBase'

const MODE_LABELS = { onsite: 'On-site', hybrid: 'Hybrid', remote: 'Remote' } as const

function Section({ icon: Icon, title, subtitle, children }: { icon: typeof Search; title: string; subtitle: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-4 flex items-start gap-3">
        <div className="bg-card ring-hairline grid size-10 shrink-0 place-items-center rounded-xl shadow-sm ring-1">
          <Icon className="size-5" />
        </div>
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
          <p className="text-muted-foreground max-w-2xl text-sm">{subtitle}</p>
        </div>
      </div>
      <div className="bg-card ring-hairline rounded-2xl p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)] ring-1 sm:p-5">{children}</div>
    </section>
  )
}

function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('grid min-w-0 content-start gap-1.5', className)}>
      <div className="flex items-center gap-1">
        <Label className="text-muted-foreground text-xs">{label}</Label>
        {hint && <InfoTip label={`About ${label}`}>{hint}</InfoTip>}
      </div>
      {children}
    </div>
  )
}

function Chips<T extends string>({ options, labels, value, onChange }: { options: readonly T[]; labels: Record<T, string>; value: T[]; onChange: (v: T[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.includes(o)
        return (
          <button
            key={o}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((v) => v !== o) : [...value, o])}
            className={cn(
              'ring-hairline flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium ring-1 transition-colors',
              on ? 'bg-foreground text-background ring-foreground' : 'text-muted-foreground hover:text-foreground bg-background',
            )}
          >
            {on && <Check className="size-3" />}
            {labels[o]}
          </button>
        )
      })}
    </div>
  )
}

function SearchProfileForm({ profile }: { profile: SearchProfile }) {
  const update = useEditor((s) => s.updateSearchProfile)
  const set = <K extends keyof SearchProfile>(key: K, value: SearchProfile[K]) =>
    update((d) => {
      d[key] = value
    })
  const text = (
    key: 'roles' | 'country' | 'locations' | 'germanLevel' | 'availability' | 'start' | 'salary' | 'workPermit' | 'targets' | 'sites' | 'avoid' | 'notes' | 'cvRules',
  ) => ({
    value: profile[key],
    onChange: (e: { target: { value: string } }) => set(key, e.target.value),
  })
  const num = (key: 'radiusKm' | 'maxAiPercent' | 'perRun' | 'minFit', min: number, max: number) => ({
    type: 'number',
    min,
    max,
    value: String(profile[key]),
    onChange: (e: { target: { value: string } }) => {
      const n = Number(e.target.value)
      if (e.target.value !== '' && Number.isFinite(n)) set(key, Math.min(max, Math.max(min, Math.round(n))))
    },
  })

  return (
    <div className="grid gap-5">
      <Field label="Roles and fields" hint="Job titles, fields and keywords, in your own words. Claude turns them into search terms in the languages of the job market.">
        <Textarea {...text('roles')} rows={3} placeholder="Data analyst, BI developer, junior data engineer…" />
      </Field>

      <div className="grid gap-4 sm:grid-cols-[10rem_1fr_8rem]">
        <Field label="Country" hint="The job market to search. Left empty, the search uses Germany and its job boards.">
          <Input {...text('country')} placeholder="Germany" />
        </Field>
        <Field label="Where" hint="Cities, regions or remote. Claude searches these places first.">
          <Input {...text('locations')} placeholder="Berlin; remote within the country" />
        </Field>
        <Field label="Radius (km)" hint="Distance around each place.">
          <Input {...num('radiusKm', 0, 200)} />
        </Field>
      </div>

      <Field label="Job types" hint="Only postings of these types are drafted.">
        <Chips options={JOB_TYPES} labels={JOB_TYPE_LABELS} value={profile.jobTypes} onChange={(v) => set('jobTypes', v)} />
      </Field>
      <Field label="Work mode" hint="On-site, hybrid or remote. Pick all that work for you.">
        <Chips options={WORK_MODES} labels={MODE_LABELS} value={profile.workModes} onChange={(v) => set('workModes', v)} />
      </Field>

      {searchesGermany(profile) && (
        <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
          <Field label="My German" hint="Your level, e.g. B1. Shown only when the search is in Germany.">
            <Input {...text('germanLevel')} placeholder="B1" />
          </Field>
          <Field label="Apply when the German required is" hint="Claude skips postings that ask for more and lists them with the reason.">
            <Select value={profile.germanLimit} onValueChange={(v) => set('germanLimit', v as GermanLimit)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {GERMAN_LIMITS.map((l) => (
                  <SelectItem key={l} value={l}>
                    {GERMAN_LIMIT_LABELS[l]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Availability" hint="Hours per week or full-time. Letters and form answers use it.">
          <Input {...text('availability')} placeholder="Full-time" />
        </Field>
        <Field label="Earliest start" hint="A date or a notice period.">
          <Input {...text('start')} placeholder="Immediately" />
        </Field>
        <Field label="Salary" hint="Your expectation, used to answer salary questions in forms.">
          <Input {...text('salary')} placeholder="€50,000 per year" />
        </Field>
      </div>

      <Field label="Work permit" hint="Only facts that limit the search, e.g. a visa that caps working hours. Leave empty if none.">
        <Textarea {...text('workPermit')} rows={2} placeholder="EU citizen, no permit needed" />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Prefer" hint="Industries, companies or teams to look for first.">
          <Textarea {...text('targets')} rows={3} placeholder="Industries, company sizes, team language…" />
        </Field>
        <Field label="Avoid" hint="Postings that match this are skipped.">
          <Textarea {...text('avoid')} rows={3} placeholder="Temp agencies, sales roles, night shifts…" />
        </Field>
      </div>

      <Field
        label="Job sites, searched first"
        hint="One per line: name, link, what it is good for. Claude starts with these in this order, then follows anything relevant it finds (company career pages)."
      >
        <Textarea {...text('sites')} rows={8} className="font-mono text-xs" placeholder="LinkedIn Jobs: https://www.linkedin.com/jobs/ (roles in English)" />
      </Field>

      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <Field label="CV and letter in" hint="The language of the CV and letter for each posting." className="sm:col-span-3 lg:col-span-2">
          <Select value={profile.docLangs} onValueChange={(v) => set('docLangs', v as DocLangs)}>
            <SelectTrigger className="w-full min-w-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              {DOC_LANGS.map((l) => (
                <SelectItem key={l} value={l}>
                  {DOC_LANG_LABELS[l]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="AI detector target (max %)" hint="Highest AI-text detector score allowed per CV or letter. Claude rewrites a document that scores higher once, keeping every fact.">
          <Input {...num('maxAiPercent', 0, 100)} />
        </Field>
        <Field label="Drafts per search" hint="How many drafts one search run prepares at most.">
          <Input {...num('perRun', 1, 20)} />
        </Field>
        <Field label="Minimum fit (0–100)" hint="Postings below this fit score are skipped and listed with the reason.">
          <Input {...num('minFit', 0, 100)} />
        </Field>
      </div>

      <Field label="Anything else Claude should know" hint="Free text. Claude reads it before every search.">
        <Textarea {...text('notes')} rows={3} placeholder="Commute by public transport only; skip companies I applied to this year…" />
      </Field>

      <Field
        label="My rules for CVs and letters"
        hint="Your own preferences for every CV and letter, on top of the common rules below. Claude and the site's AI follow both."
      >
        <Textarea {...text('cvRules')} rows={3} placeholder="Keep the summary to two sentences; list certifications before education; sign letters with my first name…" />
        <Disclosure title={<span className="text-xs">Common rules every CV follows</span>}>
          <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-xs">
            {CV_RULES.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </Disclosure>
      </Field>

      <p className="text-muted-foreground text-xs">Saved automatically. Claude reads this with get_profile, and the prompts below are built from it.</p>
    </div>
  )
}

function PromptCard({ prompt, ctx }: { prompt: ClaudePrompt; ctx: PromptContext }) {
  const [args, setArgs] = useState<Record<string, string>>({})
  const [copied, setCopied] = useState(false)
  const text = prompt.build(ctx, args)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Could not copy. Select the text below instead.')
    }
  }

  return (
    <div className="ring-hairline grid gap-3 rounded-xl p-3 ring-1">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{prompt.title}</div>
          <p className="text-muted-foreground text-xs">{prompt.description}</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void copy()}>
          {copied ? <Check /> : <Copy />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      {prompt.args.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {prompt.args.map((a) => (
            <Input
              key={a.name}
              value={args[a.name] ?? ''}
              onChange={(e) => setArgs((s) => ({ ...s, [a.name]: e.target.value }))}
              placeholder={a.placeholder}
              className="h-8 text-xs"
            />
          ))}
        </div>
      )}
      <Disclosure title={<span className="text-xs">Show the prompt</span>}>
        <pre className="bg-muted/60 max-h-96 overflow-auto rounded-lg p-3 text-[11px] leading-relaxed whitespace-pre-wrap">{text}</pre>
      </Disclosure>
    </div>
  )
}

/** The signed-in account's connector URL: hidden until asked for, then copyable. */
function ConnectorAddress() {
  const [url, setUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const reveal = async () => {
    try {
      setUrl((await api.connector()).url)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const copy = async () => {
    if (!url) return
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {url ? (
        <>
          <code className="bg-muted text-foreground min-w-0 flex-1 rounded px-2 py-1.5 font-mono text-xs break-all">{url}</code>
          <Button type="button" size="sm" variant="outline" onClick={() => void copy()}>
            {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy'}
          </Button>
        </>
      ) : (
        <Button type="button" size="sm" variant="outline" onClick={() => void reveal()}>
          Show my connector address
        </Button>
      )}
    </div>
  )
}

function ClaudeSection({ profile }: { profile: SearchProfile }) {
  const list = useEditor((s) => s.list)
  const detector = useEditor((s) => s.ai?.detector ?? null)
  const [github, setGithub] = useState('')
  const masterId = (list.find((m) => m.kind === 'master') ?? list[0])?.id

  useEffect(() => {
    if (!masterId) return
    void api
      .get(masterId)
      .then((r) => {
        const c = r.content[r.sourceLang]?.personal.contacts.find((x) => x.type === 'github')
        setGithub(c?.url || c?.value || '')
      })
      .catch(() => undefined)
  }, [masterId])

  const ctx = useMemo<PromptContext>(() => ({ profile, detector, github }), [profile, detector, github])

  return (
    <div className="grid gap-4">
      <ol className="text-muted-foreground grid list-decimal gap-1.5 pl-5 text-sm">
        <li>
          Once: in Claude, <span className="text-foreground">Settings → Connectors → Add custom connector</span>, and paste your connector address
          below. It is yours alone and works in this account only. Keep it private: it gives full access to your CVs and board.
          <ConnectorAddress />
        </li>
        <li>In Claude Desktop, turn on the connector and open the built-in browser (Ctrl+Shift+B). Sign in there once to LinkedIn, Indeed, StepStone, GPTZero and Pangram.</li>
        <li>
          Start a chat with one of these prompts: copy it here, or pick it in Claude under <span className="text-foreground">+ → Sforza</span>.
          Drafts land in Applications under “Draft”; Claude never applies.
        </li>
      </ol>
      <p className="bg-muted/60 rounded-lg px-3 py-2 text-xs">
        {detector ? (
          <>
            AI-text checks run on the server with <span className="font-medium">{detector}</span> (free plan).
          </>
        ) : (
          <>
            AI-text checks: Claude checks drafts with GPTZero and the final letter once with Pangram (the most accurate in independent tests) in the browser, on their free plans. For checks without the browser, create a free
            API key at aiornot.com and set it with <code className="font-mono">wrangler secret put AIORNOT_API_KEY</code>.
          </>
        )}
      </p>
      <div className="grid gap-3">
        {CLAUDE_PROMPTS.map((p) => (
          <PromptCard key={p.name} prompt={p} ctx={ctx} />
        ))}
      </div>
    </div>
  )
}

export const PANELS = {
  jobsearch: {
    icon: Search,
    label: 'Job search',
    subtitle: 'Your wishes and limits. Claude searches, filters and writes with them.',
  },
  knowledge: {
    icon: Library,
    label: 'Knowledge base',
    subtitle:
      'Everything beyond your master CV: projects, skills, experience, certificates and facts. Tailored CVs and letters pick from it; nothing here goes on a CV as-is.',
  },
  mcp: {
    icon: Bot,
    label: 'MCP',
    subtitle: 'Connect Claude Desktop or another AI client to this site (MCP connector) to find jobs and prepare drafts.',
  },
} satisfies Record<PanelPage, { icon: typeof Search; label: string; subtitle: string }>

/** One of the three panels about you: job search, knowledge base or MCP. */
export default function ProfilePage({ panel }: { panel: PanelPage }) {
  const profile = useEditor((s) => s.searchProfile)
  const { icon, label, subtitle } = PANELS[panel]
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-5xl flex-col px-4 py-8 sm:px-6">
        <Section icon={icon} title={label} subtitle={subtitle}>
          {panel === 'jobsearch' && profile && <SearchProfileForm profile={profile} />}
          {panel === 'knowledge' && <KnowledgeBase />}
          {panel === 'mcp' && profile && <ClaudeSection profile={profile} />}
        </Section>
      </div>
    </div>
  )
}
