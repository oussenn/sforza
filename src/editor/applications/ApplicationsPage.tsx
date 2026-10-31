import { Fragment, useEffect, useMemo, useState, type DragEvent } from 'react'
import { ArrowUpRight, CalendarClock, Download, Ellipsis, FileText, Import, Languages, Loader2, Mail, MapPin, Pencil, Plus, Search, Send, ShieldCheck, SquareKanban, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { Application, BoardColumn, BuiltinStage, Lang, ResumeMeta, Stage } from '@shared/types'
import { LANG_LABELS, LANGS } from '@shared/types'
import { baseStage, boardStages, isCustomStage, isUnsent, pdfFileName } from '@shared/utils'
import { CompanyLogo } from '@/components/CompanyLogo'
import { ScoreRing } from '@/components/ScoreRing'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { downloadLetterPdf, downloadPdf } from '@/resume/download'
import { ConfirmDialog, PromptDialog } from '../dialogs'
import { navigate } from '../router'
import { useEditor } from '../store'
import AddApplicationDialog from './AddApplicationDialog'
import AddColumnDialog from './AddColumnDialog'
import ApplicationSheet from './ApplicationSheet'
import { daysUntil, shortDate, stageDot, useStageLabel } from './stages'
import { byOrder, latestAiChecks, openCvIn, openLetter, useApplications } from './store'

const EMPTY_HINT: Record<BuiltinStage, string> = {
  saved: 'Jobs to look at later',
  draft: 'CV and letter ready: review them, then apply',
  applied: 'Drag a card here once you have applied',
  interview: 'Calls, interviews, case studies',
  offer: 'Offers on the table',
  rejected: 'Rejections and closed postings',
}

function ago(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : days < 30 ? `${days} d ago` : shortDate(iso)
}

/** Adds the tailored CVs that are not on the board yet, then looks up their company logos in the background. */
async function importTailored() {
  const before = new Set(useApplications.getState().items.map((a) => a.id))
  const items = await api.importTailored()
  useApplications.setState({ items })
  const added = items.filter((a) => !before.has(a.id))
  toast.success(`Added ${added.length} tailored CV${added.length === 1 ? '' : 's'} to “Saved”`)
  for (const app of added.filter((a) => !a.logo && a.url)) {
    const found = await api.findLogo(app.id).catch(() => null)
    if (found) useApplications.getState().replace(found)
  }
}

export default function ApplicationsPage({ appId }: { appId: string | null }) {
  const items = useApplications((s) => s.items)
  const loaded = useApplications((s) => s.loaded)
  const list = useEditor((s) => s.list)
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)

  const cvs = useMemo(() => new Map(list.map((m) => [m.id, m])), [list])
  const open = appId ? items.find((a) => a.id === appId) : undefined

  useEffect(() => {
    if (loaded && appId && !open) navigate({ page: 'applications', appId: null }, { replace: true })
  }, [loaded, appId, open])

  const q = query.trim().toLowerCase()
  const shown = q
    ? items.filter((a) =>
        [a.title, a.company, a.department, a.location, a.notes, a.contact, a.contactEmail, a.source, a.german, a.employment].some((f) => f?.toLowerCase().includes(q)),
      )
    : items
  const unlinked = list.filter((m) => m.kind === 'tailored' && m.job?.title && !items.some((a) => a.resumeId === m.id))
  const active = items.filter((a) => ['applied', 'interview'].includes(baseStage(a.stage))).length
  const drafts = items.filter((a) => baseStage(a.stage) === 'draft').length

  const runImport = async () => {
    setImporting(true)
    try {
      await importTailored()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-end gap-3 px-4 pt-6 pb-4 sm:px-6">
        <div className="mr-auto">
          <h1 className="text-2xl font-semibold tracking-tight">Applications</h1>
          <p className="text-muted-foreground text-sm">
            {items.length
              ? `${items.length} tracked · ${drafts} to review · ${active} in progress. Drag cards between stages, click one for details.`
              : 'Every job you apply to, from “Saved” to “Offer”.'}
          </p>
        </div>
        {items.length > 0 && (
          <div className="relative w-full sm:w-56">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" className="h-9 pl-8" />
          </div>
        )}
        <Button onClick={() => setAdding(true)} className="h-9 gap-2 px-4">
          <Plus /> Add application
        </Button>
      </div>

      {loaded && unlinked.length > 0 && items.length > 0 && (
        <div className="mx-auto w-full max-w-[1600px] px-4 pb-3 sm:px-6">
          <div className="bg-card ring-hairline flex flex-wrap items-center gap-3 rounded-xl px-3 py-2 text-sm ring-1">
            <FileText className="text-muted-foreground size-4" />
            <span className="flex-1">
              {unlinked.length} tailored CV{unlinked.length === 1 ? ' is' : 's are'} not on the board yet.
            </span>
            <Button size="sm" variant="outline" disabled={importing} onClick={() => void runImport()}>
              <Import /> Add {unlinked.length === 1 ? 'it' : 'them'}
            </Button>
          </div>
        </div>
      )}

      {loaded && items.length === 0 ? (
        <EmptyState unlinked={unlinked.length} importing={importing} onAdd={() => setAdding(true)} onImport={() => void runImport()} />
      ) : (
        <Board items={shown} cvs={cvs} />
      )}

      <ApplicationSheet app={open} onClose={() => navigate({ page: 'applications', appId: null })} />
      <AddApplicationDialog open={adding} onOpenChange={setAdding} />
    </div>
  )
}

function EmptyState({ unlinked, importing, onAdd, onImport }: { unlinked: number; importing: boolean; onAdd: () => void; onImport: () => void }) {
  return (
    <div className="grid flex-1 place-items-center px-4 pb-16">
      <div className="max-w-md text-center">
        <div className="bg-card ring-hairline mx-auto mb-4 grid size-12 place-items-center rounded-2xl ring-1">
          <SquareKanban className="size-6" />
        </div>
        <h2 className="text-lg font-semibold">Track your job applications</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Paste a job link to add a card with the company logo, then move it from “Saved” to “Offer”. CVs tailored to a job, by you or by
          Claude, land in “Draft” automatically.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Button onClick={onAdd}>
            <Plus /> Add application
          </Button>
          {unlinked > 0 && (
            <Button variant="outline" onClick={onImport} disabled={importing}>
              <Import /> Add my {unlinked} tailored CV{unlinked === 1 ? '' : 's'}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

interface DropTarget {
  stage: Stage
  /** card to drop above; null = end of the column */
  beforeId: string | null
}

function Board({ items, cvs }: { items: Application[]; cvs: Map<string, ResumeMeta> }) {
  const [dragId, setDragId] = useState<string | null>(null)
  const [target, setTarget] = useState<DropTarget | null>(null)
  const move = useApplications((s) => s.move)
  const columns = useApplications((s) => s.columns)
  const { renameColumn, removeColumn } = useApplications.getState()
  const stages = boardStages(columns)
  const label = useStageLabel()
  const [adding, setAdding] = useState(false)
  const [renaming, setRenaming] = useState<BoardColumn | null>(null)
  const [removing, setRemoving] = useState<BoardColumn | null>(null)
  // A card whose column was removed shows in the stage that column followed.
  const placed = (a: Application): Stage => (stages.includes(a.stage) ? a.stage : baseStage(a.stage))

  const dragOver = (stage: Stage) => (e: DragEvent<HTMLElement>) => {
    if (!dragId) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const cards = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-card]')].filter((el) => el.dataset.card !== dragId)
    const below = cards.find((el) => {
      const r = el.getBoundingClientRect()
      return e.clientY < r.top + r.height / 2
    })
    const beforeId = below?.dataset.card ?? null
    if (target?.stage !== stage || target.beforeId !== beforeId) setTarget({ stage, beforeId })
  }

  const drop = (stage: Stage) => (e: DragEvent<HTMLElement>) => {
    e.preventDefault()
    const id = dragId ?? e.dataTransfer.getData('text/plain')
    if (id && target?.stage === stage) move(id, stage, target.beforeId)
    setDragId(null)
    setTarget(null)
  }

  return (
    <div className="min-h-0 flex-1 snap-x snap-mandatory overflow-auto scroll-smooth sm:snap-none">
      <div className="mx-auto flex w-max max-w-[1600px] gap-3 px-4 pb-10 sm:px-6 xl:w-full">
        {stages.map((stage) => {
          const cards = items.filter((a) => placed(a) === stage).sort(byOrder)
          const over = target?.stage === stage
          const column = isCustomStage(stage) ? columns.find((c) => c.id === stage) : undefined
          return (
            <section
              key={stage}
              aria-label={label(stage)}
              onDragOver={dragOver(stage)}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null) && target?.stage === stage) setTarget(null)
              }}
              onDrop={drop(stage)}
              className="flex w-[82vw] shrink-0 snap-center flex-col sm:w-72 xl:w-auto xl:min-w-48 xl:flex-1"
            >
              <header className="sticky top-0 z-10 flex items-center gap-2 px-1 pt-1 pb-2 backdrop-blur-xl">
                <span className={cn('size-2 shrink-0 rounded-full', stageDot(stage))} />
                <h2 className="truncate text-sm font-semibold">{label(stage)}</h2>
                <span className="text-muted-foreground text-xs tabular-nums">{cards.length}</span>
                {column && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button type="button" aria-label={`Column ${column.label}`} className={cn(LINK, '-my-1 ml-auto size-6')}>
                        <Ellipsis className="size-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setRenaming(column)}>
                        <Pencil /> Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onSelect={() => setRemoving(column)}>
                        <Trash2 /> Delete column
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </header>
              <div
                className={cn(
                  'bg-foreground/[0.035] flex min-h-40 flex-1 flex-col gap-2 rounded-2xl p-2 transition-colors',
                  over && 'bg-foreground/[0.07]',
                )}
              >
                {cards.map((app) => (
                  <Fragment key={app.id}>
                    {over && target.beforeId === app.id && <DropLine />}
                    <ApplicationCard
                      app={app}
                      cv={app.resumeId ? cvs.get(app.resumeId) : undefined}
                      dragging={dragId === app.id}
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', app.id)
                        e.dataTransfer.effectAllowed = 'move'
                        setDragId(app.id)
                      }}
                      onDragEnd={() => {
                        setDragId(null)
                        setTarget(null)
                      }}
                    />
                  </Fragment>
                ))}
                {over && target.beforeId === null && <DropLine />}
                {!cards.length && !over && (
                  <p className="text-muted-foreground px-3 py-8 text-center text-xs">{isCustomStage(stage) ? 'Drag cards here' : EMPTY_HINT[stage]}</p>
                )}
              </div>
            </section>
          )
        })}
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="text-muted-foreground hover:text-foreground hover:bg-foreground/[0.035] border-foreground/15 mt-9 flex h-24 w-40 shrink-0 items-center justify-center gap-1.5 rounded-2xl text-xs font-medium border border-dashed transition-colors xl:w-28"
        >
          <Plus className="size-4" /> Add column
        </button>
      </div>

      <AddColumnDialog open={adding} onOpenChange={setAdding} />
      <PromptDialog
        open={!!renaming}
        onOpenChange={(o) => !o && setRenaming(null)}
        title="Rename column"
        label="Name"
        initial={renaming?.label ?? ''}
        onSubmit={(name) => renaming && void renameColumn(renaming.id, name)}
      />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Delete “${removing?.label ?? ''}”?`}
        description={removing ? `Its cards move back to “${label(baseStage(removing.id))}”. Nothing else is deleted.` : undefined}
        confirmLabel="Delete column"
        destructive
        onConfirm={async () => {
          if (removing) await removeColumn(removing.id)
          setRemoving(null)
        }}
      />
    </div>
  )
}

const DropLine = () => <div className="bg-foreground/60 mx-1 h-0.5 shrink-0 rounded-full" />

function ApplicationCard({
  app,
  cv,
  dragging,
  onDragStart,
  onDragEnd,
}: {
  app: Application
  cv: ResumeMeta | undefined
  dragging: boolean
  onDragStart: (e: DragEvent<HTMLElement>) => void
  onDragEnd: () => void
}) {
  const target = useEditor((s) => s.searchProfile?.maxAiPercent ?? 10)
  const due = app.nextDate ? daysUntil(app.nextDate) : null
  const deadline = app.deadline && isUnsent(app.stage) ? daysUntil(app.deadline) : null
  const meta = [app.location, app.workMode, app.employment || app.salary].filter(Boolean).join(' · ')
  const letters = LANGS.filter((l) => app.letters?.[l])
  const checks = latestAiChecks(app)
  const worst = checks.length ? Math.max(...checks.map((c) => c.aiPercent)) : null
  const score = cv?.job?.matchScore ?? app.fit?.score ?? null
  const chip = 'bg-muted relative z-10 flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs'

  return (
    <article
      draggable
      data-card={app.id}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        'group bg-card ring-hairline hover:ring-foreground/15 relative cursor-grab rounded-xl p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)] ring-1 transition active:cursor-grabbing',
        dragging && 'opacity-40',
        baseStage(app.stage) === 'rejected' && 'opacity-75',
      )}
    >
      <button
        type="button"
        onClick={() => navigate({ page: 'applications', appId: app.id })}
        className="absolute inset-0 rounded-xl"
        aria-label={`Open ${app.title || 'application'}`}
      />
      <div className="flex items-start gap-2.5">
        <CompanyLogo src={app.logo} name={app.company || app.title} size={36} />
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-sm leading-snug font-semibold">{app.title || 'Untitled role'}</h3>
          <p className="text-muted-foreground truncate text-xs">{app.company || 'Company not set'}</p>
        </div>
        <div className="relative z-10 -mt-1 -mr-1 flex shrink-0">
          {app.applyUrl && (
            <a href={app.applyUrl} target="_blank" rel="noreferrer" draggable={false} title="Apply on the company site" className={LINK}>
              <Send className="size-3.5" />
            </a>
          )}
          {app.url && (
            <a
              href={app.url}
              target="_blank"
              rel="noreferrer"
              draggable={false}
              title={`Open the posting${app.source ? ` (${app.source})` : ''}`}
              className={LINK}
            >
              <ArrowUpRight className="size-4" />
            </a>
          )}
        </div>
      </div>

      {meta && (
        <p className="text-muted-foreground mt-2 flex items-center gap-1 text-xs">
          <MapPin className="size-3 shrink-0" />
          <span className="truncate">{meta}</span>
        </p>
      )}

      {(app.german || deadline != null) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
          {app.german && (
            <span className="text-muted-foreground flex min-w-0 items-center gap-1" title="German asked for in the posting">
              <Languages className="size-3 shrink-0" />
              <span className="truncate">German: {app.german}</span>
            </span>
          )}
          {deadline != null && (
            <span
              className={cn(
                'flex items-center gap-1',
                deadline < 0 ? 'text-red-600 dark:text-red-400' : deadline <= 3 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground',
              )}
            >
              <CalendarClock className="size-3 shrink-0" />
              {deadline < 0 ? 'Deadline passed' : `Apply by ${shortDate(app.deadline!)}`}
            </span>
          )}
        </div>
      )}

      <div className="mt-2.5 flex flex-nowrap items-center gap-1.5">
        {cv ? (
          <span className={cn(chip, 'shrink-0 pr-0.5')} title={`CV: ${cv.name}`}>
            <FileText className="size-3 shrink-0" />
            {(cv.langs.length ? cv.langs : [app.lang ?? 'en']).map((l) => (
              <button
                key={l}
                type="button"
                draggable={false}
                onClick={() => openCvIn(cv.id, l)}
                title={`Edit the ${l.toUpperCase()} CV${l === app.lang ? ' (send this one)' : ''}`}
                className={cn(
                  'hover:bg-foreground/10 hover:text-foreground rounded px-0.5 font-mono text-[10px]',
                  l === app.lang ? 'text-foreground font-semibold' : 'text-muted-foreground',
                )}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </span>
        ) : (
          <span className="text-muted-foreground shrink-0 text-xs">No CV</span>
        )}
        {letters.length > 0 && (
          <span className={cn(chip, 'shrink-0 pr-0.5')} title="Motivation letter">
            <Mail className="size-3 shrink-0" />
            {letters.map((l) => (
              <button
                key={l}
                type="button"
                draggable={false}
                onClick={() => openLetter(app.id, l)}
                title={`Edit the ${l.toUpperCase()} letter${l === app.lang ? ' (send this one)' : ''}`}
                className={cn(
                  'hover:bg-foreground/10 hover:text-foreground rounded px-0.5 font-mono text-[10px]',
                  l === app.lang ? 'text-foreground font-semibold' : 'text-muted-foreground',
                )}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </span>
        )}
        <CardDownloads app={app} cv={cv} className={cn(chip, 'hover:bg-foreground/10 shrink-0 transition-colors')} />
      </div>

      {(worst != null || score != null) && (
        <div className="mt-2 flex items-center gap-1.5">
          {worst != null && (
            <span
              className={cn(
                'flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium',
                worst <= target
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                  : 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200',
              )}
              title={checks.map((c) => `${c.doc === 'cv' ? 'CV' : 'Letter'} ${c.lang.toUpperCase()}: ${c.aiPercent}% AI (${c.tool})`).join('\n')}
            >
              <ShieldCheck className="size-3" />
              AI {worst}%
            </span>
          )}
          {score != null && (
            <ScoreRing value={score} size={26} stroke={2.5} className="ml-auto" title={cv?.job?.matchScore != null ? 'Match score of this CV' : 'Fit estimate'} />
          )}
        </div>
      )}

      <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
        <span>
          {app.appliedOn ? `Applied ${shortDate(app.appliedOn)}` : app.postedOn ? `Posted ${shortDate(app.postedOn)}` : `Added ${ago(app.createdAt)}`}
          {app.source && ` · ${app.appliedOn ? 'via' : 'from'} ${app.source}`}
        </span>
        {jobType(app.employment) && (
          <span className="bg-muted text-foreground rounded px-1.5 py-px font-medium" title={app.employment}>
            {jobType(app.employment)}
          </span>
        )}
        {app.nextDate && (
          <span
            className={cn(
              'flex min-w-0 items-center gap-1',
              due != null && due < 0 && 'text-red-600 dark:text-red-400',
              due != null && due >= 0 && due <= 2 && 'text-amber-600 dark:text-amber-400',
            )}
            title={app.nextStep}
          >
            <CalendarClock className="size-3 shrink-0" />
            {shortDate(app.nextDate)}
          </span>
        )}
      </div>
    </article>
  )
}

/** Short job type for the card footer, read from the card's employment text. */
function jobType(employment: string | undefined): string {
  const e = (employment ?? '').toLowerCase()
  if (!e) return ''
  if (/mini ?job|minijob|450|520|538|603/.test(e)) return 'Minijob'
  if (/werkstud|working student|student employee/.test(e)) return 'Werkstudent'
  if (/aushilfe|student assistant|hiwi|hilfskraft/.test(e)) return 'Aushilfe'
  if (/intern|praktik/.test(e)) return 'Praktikum'
  if (/part[- ]time|teilzeit/.test(e)) return 'Teilzeit'
  if (/full[- ]time|vollzeit/.test(e)) return 'Vollzeit'
  return ''
}

/** CV and letter PDFs straight from the board card, without opening it. */
function CardDownloads({ app, cv, className }: { app: Application; cv: ResumeMeta | undefined; className: string }) {
  const [busy, setBusy] = useState(false)
  const cvLangs = cv?.langs ?? []
  const letterLangs = LANGS.filter((l) => app.letters?.[l])
  if (!cvLangs.length && !letterLangs.length) return null
  // The card's CV language first, then the others.
  const order = (langs: Lang[]) => [...langs].sort((a, b) => Number(b === app.lang) - Number(a === app.lang))
  const both = order(LANGS.filter((l) => cvLangs.includes(l) && letterLangs.includes(l)))

  const run = async (docs: { cv?: Lang; letter?: Lang }) => {
    setBusy(true)
    try {
      await Promise.all([useApplications.getState().flush(), useEditor.getState().flush()])
      if (docs.cv && cv) {
        const resume = await api.get(cv.id)
        await downloadPdf({ id: cv.id, lang: docs.cv, fileName: pdfFileName(resume, docs.cv) })
      }
      if (docs.letter) await downloadLetterPdf(app.id, docs.letter)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" draggable={false} disabled={busy} title="Download the CV and letter" className={className}>
          {busy ? <Loader2 className="size-3 animate-spin" /> : <Download className="size-3" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {both.map((l) => (
          <DropdownMenuItem key={`both-${l}`} onSelect={() => void run({ cv: l, letter: l })}>
            <Download /> CV + letter <span className="text-muted-foreground ml-auto font-mono text-[10px]">{l.toUpperCase()}</span>
          </DropdownMenuItem>
        ))}
        {both.length > 0 && <DropdownMenuSeparator />}
        {cvLangs.length > 0 && <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">CV</DropdownMenuLabel>}
        {order(cvLangs).map((l) => (
          <DropdownMenuItem key={`cv-${l}`} onSelect={() => void run({ cv: l })}>
            <FileText /> {LANG_LABELS[l].name}
          </DropdownMenuItem>
        ))}
        {letterLangs.length > 0 && <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">Letter</DropdownMenuLabel>}
        {order(letterLangs).map((l) => (
          <DropdownMenuItem key={`letter-${l}`} onSelect={() => void run({ letter: l })}>
            <Mail /> {LANG_LABELS[l].name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const LINK = 'text-muted-foreground hover:bg-muted hover:text-foreground grid size-7 place-items-center rounded-md transition-colors'
