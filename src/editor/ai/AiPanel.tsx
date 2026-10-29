import { useEffect, useState, type ReactNode } from 'react'
import {
  Briefcase,
  ChevronRight,
  ExternalLink,
  Gauge,
  Languages,
  Library,
  Link2,
  Loader2,
  Mail,
  MapPin,
  ShieldCheck,
  Sparkles,
  SquareKanban,
  Target,
  TriangleAlert,
  WandSparkles,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { LANG_LABELS, LANGS, type JobAnalysis, type Lang, type MatchScore } from '@shared/types'
import { contentHash, cvAtCompany, isStale, isUnsent } from '@shared/utils'
import { CompanyLogo } from '@/components/CompanyLogo'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'
import { applicationFor, useApplications } from '../applications/store'
import { StageBadge } from '../applications/stages'
import { navigate, openCv } from '../router'
import { useEditor } from '../store'
import { Disclosure, RequirementList, ScoreCard } from './ScoreCard'
import { useTranslate } from './useTranslate'

function Card({
  icon,
  media,
  title,
  subtitle,
  children,
}: {
  icon?: ReactNode
  /** replaces the icon tile, e.g. a company logo */
  media?: ReactNode
  title: string
  subtitle?: string
  children: ReactNode
}) {
  return (
    <section className="bg-card ring-hairline rounded-2xl p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] ring-1">
      <div className="mb-4 flex items-start gap-3">
        {media ?? <div className="bg-muted grid size-9 shrink-0 place-items-center rounded-xl">{icon}</div>}
        <div>
          <h3 className="text-[15px] font-bold tracking-wide uppercase">{title}</h3>
          {subtitle && <p className="text-muted-foreground mt-0.5 text-sm">{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  )
}

export default function AiPanel() {
  const ai = useEditor((s) => s.ai)
  const resume = useEditor((s) => s.resume)
  if (!resume) return null

  return (
    <div className="flex flex-col gap-3">
      {ai?.provider === 'none' && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          No AI provider is configured. Add the <code className="font-mono">OPENAI_API_KEY</code> secret to the Worker (or keep the Workers AI
          binding).
        </div>
      )}
      {resume.job && <JobCard />}
      <TailorCard />
      <TranslateCard />
      {ai && ai.provider !== 'none' && (
        <p className="text-muted-foreground px-1 text-xs">
          Using {ai.provider === 'anthropic' ? 'Claude' : ai.provider === 'openai' ? 'OpenAI' : 'Workers AI (free daily allowance)'} ·{' '}
          <span className="font-mono">{ai.model}</span> · every number and tool is fact-checked against your CV and library
          {ai.spend && (
            <span className="mt-1 block">
              Spent ${ai.spend.today.toFixed(3)} today (cap ${ai.spend.dailyLimit.toFixed(2)}) · ${ai.spend.month.toFixed(3)} this month (cap $
              {ai.spend.monthlyLimit.toFixed(2)}). AI buttons stop at the cap.
            </span>
          )}
        </p>
      )}
    </div>
  )
}

const WORK_MODE: Record<JobAnalysis['workMode'], string> = { onsite: 'On-site', hybrid: 'Hybrid', remote: 'Remote', unknown: '' }

function AnalysisSummary({ analysis, source }: { analysis: JobAnalysis; source?: string }) {
  const must = analysis.requirements.filter((r) => r.importance === 'must').length
  const facts = [
    analysis.location,
    WORK_MODE[analysis.workMode],
    analysis.seniority !== 'unknown' ? analysis.seniority : '',
    analysis.yearsRequired ? `${analysis.yearsRequired}+ years` : '',
    source ? `read via ${source}` : '',
  ].filter(Boolean)
  return (
    <div className="bg-muted/60 grid gap-1 rounded-xl p-3">
      {facts.length > 0 && (
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <MapPin className="size-3.5 shrink-0" />
          {facts.join(' · ')}
        </p>
      )}
      <Disclosure title={`${analysis.requirements.length} requirements found (${must} required, ${analysis.requirements.length - must} nice to have)`}>
        <RequirementList analysis={analysis} />
      </Disclosure>
    </div>
  )
}

function TailorCard() {
  const list = useEditor((s) => s.list)
  const resume = useEditor((s) => s.resume)!
  const aiOn = useEditor((s) => s.ai?.provider !== 'none')
  const master = list.find((m) => m.kind === 'master') ?? list[0]
  const [baseId, setBaseId] = useState(master?.id ?? resume.id)
  const [title, setTitle] = useState('')
  const [company, setCompany] = useState('')
  const [url, setUrl] = useState('')
  const [description, setDescription] = useState('')
  const [logo, setLogo] = useState('')
  const [location, setLocation] = useState('')
  // the board card this CV is made for
  const [applicationId, setApplicationId] = useState<string | null>(null)
  const application = useApplications((s) => (applicationId ? s.items.find((a) => a.id === applicationId) : undefined))
  const draft = useEditor((s) => s.tailorDraft)
  const [useLibrary, setUseLibrary] = useState(true)
  const [strict, setStrict] = useState(true)
  const [withLetter, setWithLetter] = useState(true)
  const [languages, setLanguages] = useState<Lang[]>(['fr', 'de'])
  const [busy, setBusy] = useState<'read' | 'check' | 'generate' | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  // The requirement list and a match check belong to the posting text they were computed from.
  const [analysis, setAnalysis] = useState<{ key: string; data: JobAnalysis; source?: string } | null>(null)
  const [check, setCheck] = useState<{ key: string; baseId: string; score: MatchScore } | null>(null)

  useEffect(() => {
    if (!list.some((m) => m.id === baseId) && master) setBaseId(master.id)
  }, [list, baseId, master])

  // "Tailor a CV to this job" on an application card.
  useEffect(() => {
    if (!draft) return
    setTitle(draft.title)
    setCompany(draft.company)
    setUrl(draft.url)
    setDescription(draft.description)
    setLogo(draft.logo)
    setLocation(draft.location)
    setApplicationId(draft.applicationId)
    setAnalysis(null)
    setCheck(null)
    useEditor.setState({ tailorDraft: null })
  }, [draft])

  const base = list.find((m) => m.id === baseId)
  const targets = languages.filter((l) => l !== base?.sourceLang)
  const key = `${title.trim()}\n${description.trim()}`
  const freshAnalysis = analysis?.key === key ? analysis.data : null
  const freshCheck = freshAnalysis && check?.key === key && check.baseId === baseId ? check.score : null
  const job = { title: title.trim(), company: company.trim(), url: url.trim(), description: description.trim() }

  // One CV per company department: recruiters there see every application, so a new job reuses the CV.
  const apps = useApplications((s) => s.items)
  const known = job.company ? cvAtCompany(apps, job.company, '', applicationId ?? undefined) : undefined
  const knownCv = known ? list.find((m) => m.id === known.resumeId) : undefined

  const run = async (kind: NonNullable<typeof busy>, first: string, task: () => Promise<void>) => {
    setBusy(kind)
    setProgress(first)
    try {
      await task()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(null)
      setProgress(null)
      void useEditor.getState().refreshAi()
    }
  }

  const read = () =>
    run('read', 'Reading the page…', async () => {
      const result = await api.jobFromUrl(url.trim(), setProgress)
      const j = result.job
      setTitle(j.title)
      setCompany(j.company)
      setUrl(j.url)
      setDescription(j.description)
      setLogo(j.logo)
      setLocation(j.location)
      setAnalysis({ key: `${j.title.trim()}\n${j.description.trim()}`, data: result.analysis, source: j.source })
      setCheck(null)
      toast.success(`Read “${j.title || 'job ad'}”`, { description: `${result.analysis.requirements.length} requirements found` })
    })

  const checkMatch = () =>
    run('check', 'Reading the requirements…', async () => {
      await useEditor.getState().flush()
      const result = await api.match({ resumeId: baseId, job, analysis: freshAnalysis }, setProgress)
      setAnalysis((a) => ({ key, data: result.analysis, source: a?.key === key ? a.source : undefined }))
      setCheck({ key, baseId, score: result.score })
    })

  const generate = () =>
    run('generate', 'Starting…', async () => {
      const { flush, replace } = useEditor.getState()
      await flush()
      await useApplications.getState().flush()
      const created = await api.tailor(
        {
          baseId,
          job: { ...job, logo, location },
          applicationId: applicationId ?? undefined,
          analysis: freshAnalysis,
          languages: targets,
          useLibrary,
          strict,
          letter: withLetter,
        },
        setProgress,
      )
      replace(created)
      // The new CV was added to the applications board by the server.
      void useApplications.getState().load()
      setTitle('')
      setCompany('')
      setUrl('')
      setDescription('')
      setLogo('')
      setLocation('')
      setApplicationId(null)
      setAnalysis(null)
      setCheck(null)
      openCv(created.id, 'ai')
      document.querySelector('aside')?.scrollTo({ top: 0, behavior: 'smooth' })
      const score = created.job?.score
      toast.success(`“${created.name}” is ready`, {
        description: score ? `Match score ${score.overall}%${freshCheck ? ` (the ${base?.name ?? 'base CV'} scored ${freshCheck.overall}%)` : ''}.` : undefined,
      })
    })

  const reuseCv = async () => {
    if (!known || !knownCv) return
    const store = useApplications.getState()
    await store.flush()
    let id = applicationId
    if (id) {
      store.update(id, (d) => {
        d.resumeId = knownCv.id
        d.lang = known.lang
        if (d.stage === 'saved') {
          d.stage = 'draft'
          d.history.push({ stage: 'draft', at: new Date().toISOString() })
        }
      })
    } else {
      const card = await store.create({
        title: job.title,
        company: job.company,
        url: job.url,
        description: job.description,
        location,
        logo,
        resumeId: knownCv.id,
        lang: known.lang,
        stage: 'draft',
      })
      id = card.id
      if (!card.logo && card.url) void api.findLogo(card.id).then(store.replace).catch(() => undefined)
    }
    toast.success(`“${knownCv.name}” is on the new card`, { description: 'Write a new motivation letter for this job there.' })
    navigate({ page: 'applications', appId: id })
  }

  const working = busy !== null

  return (
    <Card
      icon={<Target className="size-4.5" />}
      title="Tailor to a job"
      subtitle="Paste a job link or the posting. The AI builds a dedicated CV from your master CV and library, scores the match and translates the result."
    >
      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label className="text-muted-foreground text-xs">Job link</Label>
          <div className="flex gap-2">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && url.trim() && !working && void read()}
              placeholder="https://www.linkedin.com/jobs/view/…"
              disabled={working}
            />
            <Button variant="outline" onClick={() => void read()} disabled={working || !url.trim() || !aiOn} className="shrink-0">
              {busy === 'read' ? <Loader2 className="animate-spin" /> : <Link2 />}
              Read job
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            {busy === 'read' ? progress : 'Fills in the title, company, description and requirements. Or paste the posting below.'}
          </p>
        </div>
        {application && (
          <div className="bg-muted/60 flex items-center gap-2 rounded-xl px-3 py-2 text-sm">
            <SquareKanban className="text-muted-foreground size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              For the application <b>{application.title || 'untitled'}</b>
              {application.company && ` at ${application.company}`}
            </span>
            <Button variant="ghost" size="icon-xs" onClick={() => setApplicationId(null)} disabled={working} title="Don't link to this application">
              <X />
            </Button>
          </div>
        )}
        <div className="flex items-start gap-3">
          {(logo || company) && <CompanyLogo src={logo} name={company || title} size={40} className="mt-5.5" />}
          <div className="grid flex-1 gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label className="text-muted-foreground text-xs">Job title *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Data Engineer" disabled={working} />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-muted-foreground text-xs">Company</Label>
            <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Acme" disabled={working} />
          </div>
          </div>
        </div>
        {known && knownCv && (
          <div className="flex flex-wrap items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <p className="min-w-0 flex-1">
              {known.company} already has your CV “{knownCv.name}” ({isUnsent(known.stage) ? 'prepared' : 'sent'} for {known.title || 'another job'}
              {known.department ? `, ${known.department}` : ''}). Recruiters in a department see all your applications, so use the same CV
              and write a new letter. Generate a new CV only for a different department.
            </p>
            <Button size="sm" variant="outline" className="bg-background" onClick={() => void reuseCv()} disabled={working || !job.title}>
              Use that CV
            </Button>
          </div>
        )}
        <div className="grid gap-1.5">
          <Label className="text-muted-foreground text-xs">Job description</Label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={7}
            placeholder="Paste responsibilities, requirements, nice-to-haves…"
            className="max-h-80"
            disabled={working}
          />
        </div>

        {freshCheck && freshAnalysis ? (
          <div className="rounded-xl border p-4">
            <ScoreCard score={freshCheck} analysis={freshAnalysis} subject={base?.name} />
          </div>
        ) : (
          freshAnalysis && <AnalysisSummary analysis={freshAnalysis} source={analysis?.source} />
        )}

        <div className="bg-muted/60 grid gap-3 rounded-xl p-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label className="text-muted-foreground text-xs">Start from</Label>
            <Select value={baseId} onValueChange={setBaseId} disabled={working}>
              <SelectTrigger className="bg-background w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {list.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label className="text-muted-foreground text-xs">Also generate</Label>
            <div className="flex h-8 items-center gap-4">
              {LANGS.filter((l) => l !== base?.sourceLang).map((l) => (
                <label key={l} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={languages.includes(l)}
                    disabled={working}
                    onCheckedChange={(v) => setLanguages((cur) => (v ? [...cur, l] : cur.filter((x) => x !== l)))}
                  />
                  {LANG_LABELS[l].name}
                </label>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <Switch checked={useLibrary} onCheckedChange={setUseLibrary} disabled={working} />
            <Library className="text-muted-foreground size-4" />
            Let the AI pick extra projects &amp; skills from my library
          </label>
          <label className="flex items-start gap-2 text-sm sm:col-span-2">
            <Switch checked={withLetter} onCheckedChange={setWithLetter} disabled={working} className="mt-0.5" />
            <Mail className="text-muted-foreground mt-0.5 size-4 shrink-0" />
            <span>
              Also write a motivation letter
              <span className="text-muted-foreground block text-xs">
                In the posting&rsquo;s language, from your material only. Saved on the application card, ready to edit and download.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm sm:col-span-2">
            <Switch checked={strict} onCheckedChange={setStrict} disabled={working} className="mt-0.5" />
            <ShieldCheck className="text-muted-foreground mt-0.5 size-4 shrink-0" />
            <span>
              Keep my original wording
              <span className="text-muted-foreground block text-xs">
                {strict
                  ? 'The AI only picks and orders your bullets, projects and skills and writes the headline and summary. Nothing else is rephrased.'
                  : 'The AI may rephrase bullets. A rephrasing is kept only if it adds nothing that is not in the original line.'}
              </span>
            </span>
          </label>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            variant="outline"
            onClick={() => void checkMatch()}
            disabled={working || !title.trim() || !description.trim() || !aiOn}
            className="h-11 gap-2 rounded-xl sm:flex-1"
          >
            {busy === 'check' ? <Loader2 className="size-4 animate-spin" /> : <Gauge className="size-4" />}
            {busy === 'check' ? progress : 'Check match'}
          </Button>
          <Button
            onClick={() => void generate()}
            disabled={working || !title.trim() || !aiOn}
            className="h-11 gap-2 rounded-xl text-base font-semibold sm:flex-2"
          >
            {busy === 'generate' ? <Loader2 className="size-5 animate-spin" /> : <WandSparkles className="size-5" />}
            {busy === 'generate' ? progress : 'Generate tailored CV'}
          </Button>
        </div>
        <p className="text-muted-foreground text-center text-xs">
          {busy === 'generate'
            ? 'Usually takes 30–60 seconds. Keep this tab open.'
            : `“Check match” scores ${base?.name ?? 'the selected CV'} against this posting without creating anything.`}
        </p>
      </div>
    </Card>
  )
}

function TranslateCard() {
  const resume = useEditor((s) => s.resume)!
  const aiOn = useEditor((s) => s.ai?.provider !== 'none')
  const others = LANGS.filter((l) => l !== resume.sourceLang)
  const [targets, setTargets] = useState<Lang[]>(others)
  const { busy, progress, run } = useTranslate()

  return (
    <Card
      icon={<Languages className="size-4.5" />}
      title="Translate this CV"
      subtitle={`Translates the ${LANG_LABELS[resume.sourceLang].name} version of “${resume.name}”. Existing translations are replaced.`}
    >
      <div className="flex flex-wrap items-center gap-4">
        {others.map((l) => (
          <label key={l} className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={targets.includes(l)}
              disabled={busy}
              onCheckedChange={(v) => setTargets((cur) => (v ? [...cur, l] : cur.filter((x) => x !== l)))}
            />
            {LANG_LABELS[l].name}
            {!resume.content[l] ? (
              <Badge variant="secondary">new</Badge>
            ) : isStale(resume, l) ? (
              <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">outdated</Badge>
            ) : (
              <Badge variant="outline">up to date</Badge>
            )}
          </label>
        ))}
        <Button className="ml-auto" onClick={() => void run(targets)} disabled={busy || !targets.length || !aiOn}>
          {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
          {busy ? progress : 'Translate'}
        </Button>
      </div>
    </Card>
  )
}

function JobCard() {
  const resume = useEditor((s) => s.resume)!
  const job = resume.job!
  const app = useApplications((s) => applicationFor(s.items, resume.id))
  const [showPosting, setShowPosting] = useState(false)
  const [tracking, setTracking] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const scored = job.score ? resume.content[job.score.lang] : undefined
  const stale = !!job.score && !!scored && job.score.contentHash !== contentHash(scored)

  const rescore = async () => {
    const { flush, replace } = useEditor.getState()
    await flush()
    setProgress('Scoring…')
    try {
      const updated = await api.rescore(resume.id, setProgress)
      replace(updated)
      toast.success(`Match score: ${updated.job?.score?.overall ?? '–'}%`)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setProgress(null)
      void useEditor.getState().refreshAi()
    }
  }

  const track = async () => {
    setTracking(true)
    try {
      const created = await useApplications.getState().create({
        title: job.title,
        company: job.company,
        url: job.url,
        location: job.location ?? '',
        logo: job.logo ?? '',
        description: job.description,
        resumeId: resume.id,
        lang: resume.sourceLang,
      })
      navigate({ page: 'applications', appId: created.id })
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setTracking(false)
    }
  }

  return (
    <Card
      icon={<Briefcase className="size-4.5" />}
      media={job.logo || app?.logo ? <CompanyLogo src={app?.logo || job.logo} name={job.company || job.title} size={36} /> : undefined}
      title={job.title}
      subtitle={job.company || undefined}
    >
      <div className="grid gap-4 text-sm">
        {app ? (
          <button
            type="button"
            onClick={() => navigate({ page: 'applications', appId: app.id })}
            className="hover:bg-muted/60 -mt-1 flex items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors"
          >
            <SquareKanban className="text-muted-foreground size-4 shrink-0" />
            <span className="flex-1">Application</span>
            <StageBadge stage={app.stage} />
            <ChevronRight className="text-muted-foreground size-4" />
          </button>
        ) : (
          <Button variant="outline" size="sm" className="-mt-1 justify-start" onClick={() => void track()} disabled={tracking}>
            {tracking ? <Loader2 className="animate-spin" /> : <SquareKanban />} Track this application
          </Button>
        )}
        {job.score && job.analysis ? (
          <ScoreCard score={job.score} analysis={job.analysis} stale={stale} busy={progress !== null} progress={progress} onRescore={() => void rescore()} />
        ) : (
          <div className="bg-muted/60 flex items-center justify-between gap-3 rounded-xl p-3">
            <span className="text-muted-foreground">
              No match score yet{job.matchScore != null ? ` (the old AI estimate was ${job.matchScore}%)` : ''}.
            </span>
            <Button size="sm" onClick={() => void rescore()} disabled={progress !== null || !job.description}>
              {progress ? <Loader2 className="animate-spin" /> : <Gauge />}
              {progress ?? 'Compute score'}
            </Button>
          </div>
        )}
        {job.notes && (
          <div className="bg-muted/60 text-foreground/80 rounded-xl p-3 whitespace-pre-line">
            <div className="text-muted-foreground mb-1 text-xs font-semibold uppercase">AI notes (private)</div>
            {job.notes}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {job.url && (
            <Button variant="outline" size="sm" asChild>
              <a href={job.url} target="_blank" rel="noreferrer">
                <ExternalLink /> Posting
              </a>
            </Button>
          )}
          {job.description && (
            <Button variant="ghost" size="sm" onClick={() => setShowPosting((v) => !v)}>
              {showPosting ? 'Hide' : 'Show'} job description
            </Button>
          )}
        </div>
        {showPosting && <p className="max-h-64 overflow-y-auto rounded-xl border p-3 text-xs whitespace-pre-line">{job.description}</p>}
      </div>
    </Card>
  )
}
