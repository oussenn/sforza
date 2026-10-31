import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowUpRight, Check, ClipboardList, Copy, Download, FileText, Gauge, ImageUp, Loader2, Mail, Plus, Search, Send, ShieldCheck, Trash2, WandSparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import type { AiCheck, Application, Lang, Resume } from '@shared/types'
import { LANG_LABELS, LANGS } from '@shared/types'
import { boardStages, contentHash, pdfFileName } from '@shared/utils'
import { CompanyLogo } from '@/components/CompanyLogo'
import { ScoreRing } from '@/components/ScoreRing'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'
import { fitPng } from '@/lib/image'
import { cn } from '@/lib/utils'
import { downloadPdf } from '@/resume/download'
import { Disclosure, ScoreCard } from '../ai/ScoreCard'
import { ConfirmDialog } from '../dialogs'
import { openCv } from '../router'
import { useEditor } from '../store'
import LetterSection from './LetterSection'
import { shortDate, stageDot, useStageLabel } from './stages'
import { latestAiChecks, logoFor, openCvIn, useApplications } from './store'

const NO_CV = 'none'

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('grid min-w-0 gap-1.5', className)}>
      <Label className="text-muted-foreground text-xs">{label}</Label>
      {children}
    </div>
  )
}

export default function ApplicationSheet({ app, onClose }: { app: Application | undefined; onClose: () => void }) {
  // Keep showing the card while the panel slides out.
  const last = useRef(app)
  if (app) last.current = app
  const shown = app ?? last.current

  return (
    <Sheet open={!!app} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="gap-0 p-0 sm:max-w-xl" showCloseButton={false}>
        {shown && <Details app={shown} onClose={onClose} />}
      </SheetContent>
    </Sheet>
  )
}

function Details({ app, onClose }: { app: Application; onClose: () => void }) {
  const list = useEditor((s) => s.list)
  const apps = useApplications((s) => s.items)
  const columns = useApplications((s) => s.columns)
  const stages = boardStages(columns)
  const label = useStageLabel()
  const { update, move, remove, replace } = useApplications.getState()
  const [busy, setBusy] = useState<'logo' | 'pdf' | null>(null)
  const [deleting, setDeleting] = useState(false)
  const file = useRef<HTMLInputElement>(null)

  const set = <K extends keyof Application>(key: K, value: Application[K]) =>
    update(app.id, (d) => {
      d[key] = value
    })
  const cv = app.resumeId ? list.find((m) => m.id === app.resumeId) : undefined
  const master = list.find((m) => m.kind === 'master') ?? list[0]
  const langs = cv?.langs ?? []
  const lang: Lang | null = app.lang && langs.includes(app.lang) ? app.lang : (cv?.sourceLang ?? null)

  const findLogo = async () => {
    setBusy('logo')
    try {
      await useApplications.getState().flush()
      replace(await api.findLogo(app.id))
      toast.success('Logo found')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const uploadLogo = async (picked: File | undefined) => {
    if (!picked) return
    setBusy('logo')
    try {
      const { url } = await api.uploadImage(await fitPng(picked, 256))
      set('logo', url)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const downloadCv = async () => {
    if (!cv || !lang) return
    setBusy('pdf')
    try {
      await useEditor.getState().flush()
      const resume = await api.get(cv.id)
      await downloadPdf({ id: cv.id, lang, fileName: pdfFileName(resume, lang) })
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const tailor = () => {
    if (!master) return
    useEditor.setState({
      tailorDraft: {
        applicationId: app.id,
        title: app.title,
        company: app.company,
        url: app.url,
        description: app.description,
        location: app.location,
        logo: app.logo,
      },
    })
    openCv(master.id, 'ai')
  }

  return (
    <>
      <div className="flex items-start gap-3 border-b px-5 pt-5 pb-4">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" title="Change the logo" className="relative shrink-0 rounded-xl">
              <CompanyLogo src={app.logo} name={app.company || app.title} size={52} />
              {busy === 'logo' && (
                <span className="bg-background/70 absolute inset-0 grid place-items-center rounded-xl">
                  <Loader2 className="size-5 animate-spin" />
                </span>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem disabled={!app.url || busy !== null} onClick={() => void findLogo()}>
              <Search /> Find it on the job page
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => file.current?.click()}>
              <ImageUp /> Upload an image
            </DropdownMenuItem>
            {app.logo && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => set('logo', '')}>
                  <X /> Remove logo
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden
          onChange={(e) => {
            void uploadLogo(e.target.files?.[0])
            e.target.value = ''
          }}
        />

        <div className="min-w-0 flex-1">
          <SheetTitle className="sr-only">{app.title || 'Application'}</SheetTitle>
          <textarea
            value={app.title}
            rows={1}
            onChange={(e) => set('title', e.target.value.replace(/\n/g, ' '))}
            onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
            placeholder="Job title"
            aria-label="Job title"
            className="placeholder:text-muted-foreground field-sizing-content w-full resize-none rounded-md bg-transparent text-lg leading-tight font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          />
          <input
            value={app.company}
            onChange={(e) => set('company', e.target.value)}
            placeholder="Company"
            aria-label="Company"
            className="text-muted-foreground placeholder:text-muted-foreground/60 mt-0.5 w-full rounded-md bg-transparent text-base outline-none md:text-sm focus-visible:ring-2 focus-visible:ring-ring/40"
          />
          <SheetDescription className="sr-only">Details of this job application</SheetDescription>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {app.url && (
            <Button variant="outline" size="sm" asChild>
              <a href={app.url} target="_blank" rel="noreferrer" title={app.source ? `The posting on ${app.source}` : 'The posting'}>
                Posting <ArrowUpRight />
              </a>
            </Button>
          )}
          {app.applyUrl && (
            <Button size="sm" asChild>
              <a href={app.applyUrl} target="_blank" rel="noreferrer" title="Direct application link">
                Apply <Send />
              </a>
            </Button>
          )}
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
            <X />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="bg-muted mb-5 grid grid-cols-3 gap-0.5 rounded-xl p-0.5 sm:grid-cols-[repeat(auto-fit,minmax(5.5rem,1fr))]">
          {stages.map((stage) => (
            <button
              key={stage}
              type="button"
              onClick={() => move(app.id, stage)}
              aria-pressed={app.stage === stage}
              className={cn(
                'text-muted-foreground hover:text-foreground flex h-8 items-center justify-center gap-1.5 rounded-[10px] px-1 text-xs font-medium transition-colors',
                app.stage === stage && 'bg-background text-foreground shadow-sm',
              )}
            >
              <span className={cn('hidden size-1.5 shrink-0 rounded-full sm:block', stageDot(stage))} />
              <span className="truncate">{label(stage)}</span>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-4">
          <Field label="Job posting">
            <Input value={app.url} onChange={(e) => set('url', e.target.value)} placeholder="https://www.linkedin.com/jobs/view/…" />
          </Field>
          <Field label="Direct application link">
            <Input value={app.applyUrl ?? ''} onChange={(e) => set('applyUrl', e.target.value)} placeholder="Company career page or application form" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Location">
              <Input value={app.location} onChange={(e) => set('location', e.target.value)} placeholder="City" />
            </Field>
            <Field label="Department">
              <Input value={app.department ?? ''} onChange={(e) => set('department', e.target.value)} placeholder="Data & Analytics" />
            </Field>
            <Field label="Work mode">
              <Input value={app.workMode ?? ''} onChange={(e) => set('workMode', e.target.value)} placeholder="On-site, Hybrid, Remote" list="work-modes" />
              <datalist id="work-modes">
                {['On-site', 'Hybrid', 'Remote'].map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </Field>
            <Field label="Type">
              <Input value={app.employment ?? ''} onChange={(e) => set('employment', e.target.value)} placeholder="Full-time · Permanent" />
            </Field>
            <Field label="German required">
              <Input value={app.german ?? ''} onChange={(e) => set('german', e.target.value)} placeholder="Not required, B2, fluent…" />
            </Field>
            <Field label="Salary">
              <Input value={app.salary} onChange={(e) => set('salary', e.target.value)} placeholder="€18/h, 55k…" />
            </Field>
            <Field label="Apply by">
              <Input type="date" value={app.deadline ?? ''} onChange={(e) => set('deadline', e.target.value)} />
            </Field>
            <Field label="Applied on">
              <Input type="date" value={app.appliedOn} onChange={(e) => set('appliedOn', e.target.value)} />
            </Field>
            <Field label="Posted on">
              <Input type="date" value={app.postedOn ?? ''} onChange={(e) => set('postedOn', e.target.value)} />
            </Field>
            <Field label={app.appliedOn ? 'Applied via' : 'Found on'}>
              <Input value={app.source ?? ''} onChange={(e) => set('source', e.target.value)} placeholder="LinkedIn, Indeed…" list="application-sources" />
              <datalist id="application-sources">
                {['LinkedIn', 'Indeed', 'StepStone', 'XING', 'Bundesagentur für Arbeit', 'Company career page', 'Email', 'Referral', 'Career fair'].map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </Field>
            <Field label="Contact">
              <Input value={app.contact} onChange={(e) => set('contact', e.target.value)} placeholder="Name, role" />
            </Field>
            <Field label="Contact e-mail">
              <div className="flex gap-1.5">
                <Input type="email" value={app.contactEmail ?? ''} onChange={(e) => set('contactEmail', e.target.value)} placeholder="jobs@company.de" />
                {app.contactEmail?.includes('@') && (
                  <Button variant="outline" size="icon" asChild title={`Write to ${app.contactEmail}`}>
                    <a href={`mailto:${app.contactEmail}`}>
                      <Mail />
                    </a>
                  </Button>
                )}
              </div>
            </Field>
            <div className="col-span-2 flex items-start gap-3">
              <Field label="Next step" className="min-w-0 flex-1">
                <Textarea
                  value={app.nextStep}
                  onChange={(e) => set('nextStep', e.target.value)}
                  rows={3}
                  placeholder="Follow up, interview…"
                  className="min-h-0 text-sm"
                />
              </Field>
              <Field label="Due" className="w-36">
                <Input type="date" value={app.nextDate} onChange={(e) => set('nextDate', e.target.value)} />
              </Field>
            </div>
          </div>

          <FitBlock app={app} />

          <div className="bg-muted/50 grid grid-cols-1 gap-3 rounded-xl p-3">
            <div className="flex items-end gap-2">
              <Field label={app.appliedOn ? 'CV sent' : 'CV to send'} className="min-w-0 flex-1">
                <Select
                  value={app.resumeId ?? NO_CV}
                  onValueChange={(id) =>
                    update(app.id, (d) => {
                      const meta = list.find((m) => m.id === id)
                      d.resumeId = meta ? meta.id : null
                      d.lang = meta ? (d.lang && meta.langs.includes(d.lang) ? d.lang : meta.sourceLang) : null
                    })
                  }
                >
                  <SelectTrigger className="bg-background w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper" className="max-h-72">
                    <SelectItem value={NO_CV}>No CV yet</SelectItem>
                    {list.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.kind === 'tailored' ? (
                          <CompanyLogo src={logoFor(apps, m)} name={m.job?.company || m.name} size={18} />
                        ) : (
                          <FileText />
                        )}
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            {cv ? (
              <div className="flex flex-wrap items-center gap-2">
                {langs.length > 1 && (
                  <div className="bg-background flex items-center rounded-lg p-0.5 ring-1 ring-hairline">
                    {langs.map((l) => (
                      <button
                        key={l}
                        type="button"
                        onClick={() => set('lang', l)}
                        title={`Sent the ${LANG_LABELS[l].name} version`}
                        className={cn(
                          'text-muted-foreground hover:text-foreground h-7 rounded-md px-2.5 text-xs font-semibold',
                          l === lang && 'bg-muted text-foreground',
                        )}
                      >
                        {LANG_LABELS[l].short}
                      </button>
                    ))}
                  </div>
                )}
                <Button variant="outline" size="sm" className="ml-auto" onClick={() => openCvIn(cv.id, lang)}>
                  <FileText /> Edit CV
                </Button>
                <Button size="sm" onClick={() => void downloadCv()} disabled={busy === 'pdf'}>
                  {busy === 'pdf' ? <Loader2 className="animate-spin" /> : <Download />}
                  PDF{lang ? ` (${lang.toUpperCase()})` : ''}
                </Button>
              </div>
            ) : (
              <Button variant="outline" onClick={tailor} disabled={!app.title.trim()} className="justify-start">
                <WandSparkles /> Tailor a CV to this job
              </Button>
            )}
          </div>

          {cv?.job && <MatchBlock key={cv.id} resumeId={cv.id} app={app} />}

          <LetterSection key={app.id} app={app} />

          <FormAnswers app={app} />

          <AiChecks app={app} cvLangs={langs} />

          <Disclosure title="Job description">
            <Textarea
              value={app.description}
              onChange={(e) => set('description', e.target.value)}
              rows={8}
              placeholder="Paste the job ad to keep a copy (postings often go offline)."
              className="max-h-96 text-xs"
            />
          </Disclosure>

          <div>
            <div className="text-muted-foreground mb-2 text-xs font-medium">History</div>
            <ol className="border-border ml-1 grid gap-2 border-l pl-4">
              {app.history.map((h, i) => (
                <li key={`${h.at}-${i}`} className="relative text-xs">
                  <span className={cn('ring-background absolute top-1 -left-[21px] size-2 rounded-full ring-2', stageDot(h.stage))} />
                  <span className="font-medium">{i === 0 ? `Added to ${label(h.stage)}` : label(h.stage)}</span>
                  <span className="text-muted-foreground"> · {shortDate(h.at)}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between border-t px-5 py-3">
        <span className="text-muted-foreground text-xs">Saved automatically</span>
        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeleting(true)}>
          <Trash2 /> Delete
        </Button>
      </div>

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete “${app.title || 'this application'}”?`}
        description="The card, its notes and letters are removed, and its tailored CV too unless another card uses it. The master CV is kept."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          onClose()
          await remove(app.id)
        }}
      />
    </>
  )
}

/** The CV's match score against its posting: every requirement with its evidence, the ATS keywords, per dimension. */
function MatchBlock({ resumeId, app }: { resumeId: string; app: Application }) {
  const aiOn = useEditor((s) => s.ai?.provider !== 'none')
  const updatedAt = useEditor((s) => s.list.find((m) => m.id === resumeId)?.updatedAt)
  const [resume, setResume] = useState<Resume | null>(null)
  const [progress, setProgress] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    api
      .get(resumeId)
      .then((r) => alive && setResume(r))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [resumeId, updatedAt])

  const job = resume?.job
  if (!resume || !job) return null
  const scored = job.score ? resume.content[job.score.lang] : undefined
  const stale = !!job.score && !!scored && job.score.contentHash !== contentHash(scored)
  // A CV saved without the posting's text is scored against the text kept on this card.
  const fallback = job.description?.trim() ? undefined : app.description
  const canScore = aiOn && !!(job.description?.trim() || app.description.trim())

  const compute = async () => {
    await useEditor.getState().flush()
    setProgress('Scoring…')
    try {
      const updated = await api.rescore(resumeId, setProgress, fallback)
      setResume(updated)
      const editor = useEditor.getState()
      if (editor.resume?.id === updated.id) editor.replace(updated)
      void editor.refreshList()
      toast.success(`Match score: ${updated.job?.score?.overall ?? '–'}%`)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setProgress(null)
      void useEditor.getState().refreshAi()
    }
  }

  return (
    <div className="grid gap-1.5">
      <Label className="text-muted-foreground text-xs">Match score</Label>
      {job.title.trim().toLowerCase() !== app.title.trim().toLowerCase() && (
        <p className="text-muted-foreground text-xs">This CV was tailored to “{job.title}”, so the score is for that posting.</p>
      )}
      {job.score && job.analysis ? (
        <div className="rounded-xl border p-3">
          <ScoreCard
            score={job.score}
            analysis={job.analysis}
            stale={stale}
            busy={progress !== null}
            progress={progress}
            onRescore={canScore ? () => void compute() : undefined}
          />
        </div>
      ) : (
        <div className="bg-muted/60 flex items-center justify-between gap-3 rounded-xl p-3">
          <span className="text-muted-foreground text-sm">Not scored yet. The score checks each requirement of the posting against this CV.</span>
          <Button size="sm" onClick={() => void compute()} disabled={progress !== null || !canScore}>
            {progress ? <Loader2 className="animate-spin" /> : <Gauge />}
            {progress ?? 'Compute score'}
          </Button>
        </div>
      )}
    </div>
  )
}

/** Claude's (or the user's) estimate of how well the job fits. */
function FitBlock({ app }: { app: Application }) {
  const { update } = useApplications.getState()
  const fit = app.fit ?? { score: null, summary: '' }
  const setFit = (patch: Partial<NonNullable<Application['fit']>>) =>
    update(app.id, (d) => {
      d.fit = { ...(d.fit ?? { score: null, summary: '' }), ...patch }
    })
  return (
    <div className="grid gap-1.5">
      <Label className="text-muted-foreground text-xs">Fit</Label>
      <div className="flex items-start gap-3">
        <div className="grid justify-items-center gap-1.5">
          {fit.score != null ? (
            <ScoreRing value={fit.score} size={40} stroke={3} title="Fit estimate" />
          ) : (
            <div className="ring-hairline size-10 rounded-full ring-4 ring-inset" />
          )}
          <Input
            type="number"
            min={0}
            max={100}
            value={fit.score ?? ''}
            onChange={(e) => {
              const n = Number(e.target.value)
              setFit({ score: e.target.value === '' || !Number.isFinite(n) ? null : Math.min(100, Math.max(0, Math.round(n))) })
            }}
            className="h-7 w-16 px-1 text-center text-xs"
            aria-label="Fit score (0–100)"
          />
        </div>
        <Textarea
          value={fit.summary}
          onChange={(e) => setFit({ summary: e.target.value })}
          rows={3}
          placeholder="Why it fits, and the gaps"
          className="min-h-0 flex-1 text-sm"
        />
      </div>
    </div>
  )
}

const DOC_LABEL: Record<AiCheck['doc'], string> = { cv: 'CV', letter: 'Letter' }

/** Latest AI-detector result per document and language, with a button to check again when the server has a detector. */
function AiChecks({ app, cvLangs }: { app: Application; cvLangs: Lang[] }) {
  const detector = useEditor((s) => s.ai?.detector ?? null)
  const target = useEditor((s) => s.searchProfile?.maxAiPercent ?? 10)
  const [busy, setBusy] = useState<string | null>(null)
  const latest = new Map(latestAiChecks(app).map((c) => [`${c.doc}:${c.lang}`, c]))
  const rows = new Map<string, { doc: AiCheck['doc']; lang: Lang }>()
  for (const lang of cvLangs) rows.set(`cv:${lang}`, { doc: 'cv', lang })
  for (const lang of LANGS) if (app.letters?.[lang]) rows.set(`letter:${lang}`, { doc: 'letter', lang })
  for (const c of latest.values()) rows.set(`${c.doc}:${c.lang}`, { doc: c.doc, lang: c.lang })
  if (!latest.size && !(detector && rows.size)) return null

  const run = async (doc: AiCheck['doc'], lang: Lang) => {
    setBusy(`${doc}:${lang}`)
    try {
      await Promise.all([useApplications.getState().flush(), useEditor.getState().flush()])
      useApplications.getState().replace(await api.aiCheck(app.id, doc, lang))
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="bg-muted/50 grid grid-cols-1 gap-2 rounded-xl p-3">
      <div className="flex items-center gap-2">
        <ShieldCheck className="text-muted-foreground size-4" />
        <span className="flex-1 text-sm font-medium">AI-text checks</span>
        <span className="text-muted-foreground text-xs">target ≤ {target}%</span>
      </div>
      <ul className="grid grid-cols-1 gap-1">
        {[...rows.entries()].map(([key, { doc, lang }]) => {
          const check = latest.get(key)
          return (
            <li key={key} className="bg-background ring-hairline flex min-w-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs ring-1">
              <span className="w-20 shrink-0 font-medium">
                {DOC_LABEL[doc]} <span className="text-muted-foreground font-mono text-[10px]">{lang.toUpperCase()}</span>
              </span>
              {check ? (
                <span className="min-w-0 flex-1 truncate" title={check.note}>
                  <span
                    className={cn(
                      'font-semibold tabular-nums',
                      check.aiPercent <= target ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400',
                    )}
                  >
                    {check.aiPercent}% AI
                  </span>
                  <span className="text-muted-foreground">
                    {' '}
                    · {check.tool} · {shortDate(check.at)}
                    {check.note ? ` · ${check.note}` : ''}
                  </span>
                </span>
              ) : (
                <span className="text-muted-foreground flex-1">Not checked</span>
              )}
              {detector && (
                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={busy !== null} onClick={() => void run(doc, lang)}>
                  {busy === key ? <Loader2 className="animate-spin" /> : null}
                  Check
                </Button>
              )}
            </li>
          )
        })}
      </ul>
      {!detector && (
        <p className="text-muted-foreground text-[11px]">Claude records the scores of the detector it used in the browser (GPTZero, ZeroGPT…).</p>
      )}
    </div>
  )
}

/** Answers to the online application form, one copy button each, so filling in the form is copy and paste. */
function FormAnswers({ app }: { app: Application }) {
  const { update } = useApplications.getState()
  const [copied, setCopied] = useState<number | null>(null)
  const answers = app.formAnswers ?? []
  const edit = (fn: (list: NonNullable<Application['formAnswers']>) => void) =>
    update(app.id, (d) => {
      d.formAnswers = [...(d.formAnswers ?? [])]
      fn(d.formAnswers)
    })
  const copy = async (i: number) => {
    try {
      await navigator.clipboard.writeText(answers[i].answer)
      setCopied(i)
      setTimeout(() => setCopied((c) => (c === i ? null : c)), 1500)
    } catch {
      toast.error('Could not copy; select the text instead.')
    }
  }
  const formUrl = app.applyUrl && !app.applyUrl.startsWith('mailto:') ? app.applyUrl : ''

  return (
    <div className="bg-muted/50 grid gap-2 rounded-xl p-3">
      <div className="flex items-center gap-2">
        <ClipboardList className="text-muted-foreground size-4" />
        <span className="flex-1 text-sm font-medium">Application form</span>
        {formUrl && (
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" asChild>
            <a href={formUrl} target="_blank" rel="noreferrer">
              Open form <ArrowUpRight />
            </a>
          </Button>
        )}
      </div>
      {answers.length === 0 && (
        <p className="text-muted-foreground text-xs">
          Claude saves the answers to the form&apos;s questions here (save_form_answers), ready to copy. You can also add them yourself.
        </p>
      )}
      {answers.map((a, i) => (
        <div key={i} className="bg-background ring-hairline grid gap-1.5 rounded-lg p-2.5 ring-1">
          <div className="flex items-start gap-2">
            <Textarea
              value={a.question}
              onChange={(e) => edit((l) => (l[i] = { ...l[i], question: e.target.value }))}
              rows={Math.max(1, Math.ceil(a.question.length / 60))}
              placeholder="Question"
              className="min-h-0 min-w-0 flex-1 resize-none rounded-none border-0 bg-transparent p-0 text-xs font-semibold shadow-none focus-visible:ring-0 dark:bg-transparent"
              aria-label="Question"
            />
            <Button size="sm" variant="outline" className="h-7 shrink-0 px-2 text-xs" onClick={() => void copy(i)} disabled={!a.answer.trim()}>
              {copied === i ? <Check /> : <Copy />}
              {copied === i ? 'Copied' : 'Copy'}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="text-muted-foreground size-7 shrink-0"
              onClick={() => edit((l) => void l.splice(i, 1))}
              title="Remove question"
            >
              <X />
            </Button>
          </div>
          {a.note && <p className="rounded-md bg-amber-500/10 px-2 py-1 text-[11px] text-amber-800 dark:text-amber-300">{a.note}</p>}
          <Textarea
            value={a.answer}
            onChange={(e) => edit((l) => (l[i] = { ...l[i], answer: e.target.value }))}
            rows={Math.min(8, Math.max(1, Math.ceil(a.answer.length / 70)))}
            placeholder="Answer"
            className="bg-background min-h-0 text-sm"
          />
        </div>
      ))}
      <Button size="sm" variant="ghost" className="text-muted-foreground w-fit text-xs" onClick={() => edit((l) => void l.push({ question: '', answer: '' }))}>
        <Plus /> Add question
      </Button>
    </div>
  )
}
