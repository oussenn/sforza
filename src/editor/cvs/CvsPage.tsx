import { useMemo, useState } from 'react'
import { ArrowUpRight, Crown, Files, Star } from 'lucide-react'
import { TEMPLATE_MAP } from '@shared/templates'
import type { Resume, ResumeMeta } from '@shared/types'
import { LANG_LABELS, LANGS } from '@shared/types'
import { isStale } from '@shared/utils'
import { CompanyLogo } from '@/components/CompanyLogo'
import { ScoreRing } from '@/components/ScoreRing'
import { PreviewSheet } from '@/components/PreviewSheet'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useWide } from '@/lib/useMedia'
import { cn } from '@/lib/utils'
import { ResumePreview } from '@/resume/ResumePreview'
import type { DocProps } from '@/resume/ResumeDocument'
import AiPanel from '../ai/AiPanel'
import { applicationFor, logoFor, useApplications } from '../applications/store'
import { stageDot } from '../applications/stages'
import ContentPanel from '../content/ContentPanel'
import CustomizePanel from '../customize/CustomizePanel'
import { navigate, openCv, setCvTab, useRoute, type CvTab } from '../router'
import { ListSidebar, SidebarRow, SidebarToggle } from '../sidebar'
import { useEditor } from '../store'

const TABS: { id: CvTab; label: string }[] = [
  { id: 'content', label: 'Content' },
  { id: 'customize', label: 'Customize' },
  { id: 'ai', label: 'AI Tools' },
]

/** The job of a tailored CV; otherwise what kind of CV it is and its template. */
const subtitleOf = (m: Pick<ResumeMeta, 'kind' | 'job' | 'template'>) =>
  m.job
    ? [m.job.title, m.job.company].filter(Boolean).join(' · ')
    : [m.kind === 'master' ? 'Master' : 'Copy', TEMPLATE_MAP[m.template]?.name].filter(Boolean).join(' · ')

/** The master CV first, then the newest copies. Not by last edit, so the open CV stays where it is while you type. */
const order = (a: ResumeMeta, b: ResumeMeta) =>
  a.kind === 'master' !== (b.kind === 'master') ? (a.kind === 'master' ? -1 : 1) : b.createdAt.localeCompare(a.createdAt)

/** My CVs, laid out like My Cover Letters: the list, the open CV's editor, its A4 page. */
export default function CvsPage({ cv, preview }: { cv: Resume | null; preview: DocProps | null }) {
  const route = useRoute()
  const list = useEditor((s) => s.list)
  const apps = useApplications((s) => s.items)
  const [query, setQuery] = useState('')
  const tab: CvTab = route.page === 'cv' ? route.tab : 'content'
  const openId = route.page === 'cv' ? route.id : null

  const sorted = useMemo(() => [...list].sort(order), [list])
  const q = query.trim().toLowerCase()
  const shown = q ? sorted.filter((m) => `${m.name} ${m.job?.title ?? ''} ${m.job?.company ?? ''}`.toLowerCase().includes(q)) : sorted
  const master = list.find((m) => m.kind === 'master') ?? list[0]
  const app = cv ? applicationFor(apps, cv.id) : undefined
  const wide = useWide()

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
      <ListSidebar
        label="CVs"
        query={query}
        onQuery={setQuery}
        placeholder="CV, company or role"
        onNew={() => master && openCv(master.id, 'ai')}
        newTitle="Tailor a CV to a job posting"
      >
        {shown.map((m) => {
          const linked = applicationFor(apps, m.id)
          return (
            <SidebarRow
              key={m.id}
              href={`/cv/${encodeURIComponent(m.id)}`}
              onOpen={() => openCv(m.id)}
              active={m.id === openId}
              media={<CvMark meta={m} logo={logoFor(apps, m)} />}
              title={m.name}
              badge={m.isMain && <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-400" aria-label="Main CV" />}
              subtitle={subtitleOf(m)}
              meta={
                <>
                  {linked ? (
                    <span className={cn('size-2 rounded-full', stageDot(linked.stage))} />
                  ) : m.kind === 'master' ? (
                    <Crown className="text-muted-foreground size-3" aria-label="Master" />
                  ) : (
                    <span className="size-2" />
                  )}
                  <span className="text-muted-foreground text-[10px] font-semibold tracking-wide">{m.langs.map((l) => LANG_LABELS[l].short).join(' ')}</span>
                </>
              }
            />
          )
        })}
      </ListSidebar>

      {cv ? (
        <div className="flex min-h-0 flex-1 flex-col gap-6 p-4 lg:flex-row lg:overflow-hidden lg:p-6">
          <section className="flex min-w-0 flex-col gap-3 max-lg:pb-44 lg:w-[30rem] lg:shrink-0 lg:overflow-y-auto lg:pr-1">
            <header className="flex items-start gap-2">
              <SidebarToggle className="mt-0.5 -ml-1.5" />
              <div className="min-w-0 flex-1">
                <h1 className="flex items-center gap-1.5 text-lg font-semibold tracking-tight">
                  <span className="truncate">{cv.name}</span>
                  {cv.isMain && <Star className="size-4 shrink-0 fill-amber-400 text-amber-400" aria-label="Main CV" />}
                </h1>
                <p className="text-muted-foreground truncate text-sm">{subtitleOf(cv)}</p>
              </div>
              {cv.job?.matchScore != null && <ScoreRing value={cv.job.matchScore} size={34} stroke={3} title={`Match score for ${cv.job.title}`} />}
              {app && (
                <Button size="sm" variant="ghost" onClick={() => navigate({ page: 'applications', appId: app.id })}>
                  Card <ArrowUpRight />
                </Button>
              )}
            </header>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="bg-muted ring-hairline flex w-fit items-center rounded-lg p-0.5 ring-1">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setCvTab(t.id)}
                    aria-pressed={tab === t.id}
                    className={cn(
                      'text-muted-foreground hover:text-foreground h-7 rounded-md px-3 text-xs font-medium',
                      tab === t.id && 'bg-background text-foreground shadow-sm',
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <CvLanguages cv={cv} />
            </div>
            {tab === 'content' && <ContentPanel />}
            {tab === 'customize' && <CustomizePanel />}
            {tab === 'ai' && <AiPanel />}
          </section>
          {wide ? (
            <section className="min-w-0 flex-1 overflow-y-auto">
              {preview && (
                <div className="mx-auto max-w-[720px]">
                  <ResumePreview {...preview} padding={0} />
                </div>
              )}
            </section>
          ) : (
            preview && (
              <PreviewSheet title={cv.name} subtitle={subtitleOf(cv)}>
                <ResumePreview {...preview} padding={0} />
              </PreviewSheet>
            )
          )}
        </div>
      ) : !list.length ? (
        <div className="text-muted-foreground relative grid flex-1 place-items-center p-8 text-sm">
          <SidebarToggle className="absolute top-4 left-4" />
          <div className="flex flex-col items-center gap-3">
            <Files className="size-6" />
            No CV yet.
          </div>
        </div>
      ) : (
        <div className="grid flex-1 place-items-center">
          <div className="border-muted border-t-foreground size-6 animate-spin rounded-full border-2" />
        </div>
      )}
    </div>
  )
}

/** The company's logo for a tailored CV; the template's colour with the photo or the first letter otherwise. */
function CvMark({ meta, logo }: { meta: ResumeMeta; logo: string }) {
  if (meta.kind === 'tailored' && meta.job) return <CompanyLogo src={logo} name={meta.job.company || meta.name} size={32} />
  const accent = TEMPLATE_MAP[meta.template]?.style.accent ?? '#333'
  return (
    <span className="relative grid size-8 shrink-0 place-items-center overflow-hidden rounded-lg" style={{ background: accent }}>
      {meta.photo ? <img src={meta.photo} alt="" className="size-full object-cover" /> : <span className="text-sm font-semibold text-white">{meta.name[0]}</span>}
    </span>
  )
}

/** The CV's language, as the letter's is on My Cover Letters. An amber dot marks a translation older than its source. */
function CvLanguages({ cv }: { cv: Resume }) {
  const lang = useEditor((s) => s.lang)
  const setLang = useEditor((s) => s.setLang)
  return (
    <div className="bg-background ring-hairline flex items-center rounded-lg p-0.5 ring-1">
      {LANGS.map((l) => {
        const has = !!cv.content[l]
        const stale = isStale(cv, l)
        return (
          <Tooltip key={l}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setLang(l)}
                aria-pressed={l === lang}
                className={cn(
                  'text-muted-foreground hover:text-foreground relative h-7 rounded-md px-2.5 text-xs font-semibold',
                  l === lang && 'bg-muted text-foreground',
                  !has && 'opacity-50',
                )}
              >
                {LANG_LABELS[l].short}
                {stale && <span className="absolute top-1 right-1 size-1.5 rounded-full bg-amber-500" />}
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {LANG_LABELS[l].name}
              {l === cv.sourceLang ? ' · source' : !has ? ' · not translated yet' : stale ? ' · outdated translation' : ''}
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}
