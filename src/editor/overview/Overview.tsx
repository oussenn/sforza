import { useState } from 'react'
import { ArrowRight, Copy, Crown, FilePlus2, Library, MoreHorizontal, Plus, Star, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { TEMPLATE_MAP } from '@shared/templates'
import type { ResumeMeta } from '@shared/types'
import { LANG_LABELS } from '@shared/types'
import { CompanyLogo } from '@/components/CompanyLogo'
import { ScoreRing } from '@/components/ScoreRing'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { applicationFor, logoFor, useApplications } from '../applications/store'
import { StageBadge } from '../applications/stages'
import { ConfirmDialog } from '../dialogs'
import { navigate, openCv } from '../router'
import { useEditor } from '../store'

function ago(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`
  return new Date(iso).toLocaleDateString()
}

export default function Overview() {
  const list = useEditor((s) => s.list)
  const current = useEditor((s) => s.resume?.id)
  const apps = useApplications((s) => s.items)
  const [deleting, setDeleting] = useState<ResumeMeta | null>(null)
  const { setMain, duplicate, remove } = useEditor.getState()
  const master = list.find((m) => m.kind === 'master') ?? list[0]
  const newTailored = () => master && openCv(master.id, 'ai')

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-8 sm:px-6">
        <section>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">My CVs</h1>
              <p className="text-muted-foreground text-sm">
                The CV marked <Star className="inline size-3.5 fill-amber-400 text-amber-400" /> is your main CV: the default for downloads and new tailored CVs.
              </p>
            </div>
            <Button onClick={newTailored} className="gap-2">
              <Plus /> New tailored CV
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((m) => {
              const accent = TEMPLATE_MAP[m.template]?.style.accent ?? '#333'
              const app = applicationFor(apps, m.id)
              return (
                <article
                  key={m.id}
                  className={cn(
                    'group bg-card ring-hairline relative flex flex-col rounded-2xl p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)] ring-1 transition hover:shadow-md',
                    m.id === current && 'ring-foreground/25 ring-2',
                  )}
                >
                  <a
                    href={`/cv/${encodeURIComponent(m.id)}`}
                    onClick={(e) => {
                      // Plain clicks stay in the app; Ctrl/⌘-click opens a new tab.
                      if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return
                      e.preventDefault()
                      openCv(m.id, 'content')
                    }}
                    className="absolute inset-0 rounded-2xl"
                    aria-label={`Open ${m.name}`}
                  />
                  <div className="flex items-start gap-3">
                    {m.kind === 'tailored' && m.job ? (
                      <CompanyLogo src={logoFor(apps, m)} name={m.job.company || m.name} size={48} />
                    ) : (
                      <div className="relative grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl" style={{ background: accent }}>
                        {m.photo ? (
                          <img src={m.photo} alt="" className="size-full object-cover" />
                        ) : (
                          <span className="text-lg font-semibold text-white">{m.name[0]}</span>
                        )}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <h2 className="truncate font-semibold">{m.name}</h2>
                        {m.isMain && <Star className="size-4 shrink-0 fill-amber-400 text-amber-400" />}
                      </div>
                      <p className="text-muted-foreground truncate text-sm">
                        {m.job ? [m.job.title, m.job.company].filter(Boolean).join(' · ') : m.kind === 'master' ? 'Master CV' : 'Copy'}
                      </p>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" className="relative z-10 -mt-1 -mr-1">
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {!m.isMain && (
                          <DropdownMenuItem
                            onClick={() => void setMain(m.id).then(() => toast.success(`"${m.name}" is now your main CV`))}
                          >
                            <Star /> Make main CV
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          onClick={async () => {
                            const copy = await duplicate(m.id)
                            toast.success(`Created "${copy.name}"`)
                          }}
                        >
                          <Copy /> Duplicate
                        </DropdownMenuItem>
                        {m.kind !== 'master' && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" disabled={m.isMain} onClick={() => setDeleting(m)}>
                              <Trash2 /> Delete
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-1.5">
                    {m.kind === 'master' && (
                      <Badge className="gap-1">
                        <Crown className="size-3" /> Master
                      </Badge>
                    )}
                    {m.langs.map((l) => (
                      <Badge key={l} variant="outline" className="font-mono text-[10px]">
                        {LANG_LABELS[l].short}
                      </Badge>
                    ))}
                    <Badge variant="secondary">{TEMPLATE_MAP[m.template]?.name}</Badge>
                    {m.job?.matchScore != null && (
                      <ScoreRing value={m.job.matchScore} size={34} stroke={3} className="ml-auto" title={`Match score for ${m.job.title}`} />
                    )}
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <p className="text-muted-foreground text-xs">Edited {ago(m.updatedAt)}</p>
                    {app && <StageBadge stage={app.stage} className="ml-auto" />}
                  </div>
                </article>
              )
            })}
            <button
              type="button"
              onClick={newTailored}
              className="border-foreground/15 text-muted-foreground hover:border-foreground/30 hover:text-foreground flex min-h-40 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed transition"
            >
              <FilePlus2 className="size-6" />
              <span className="text-sm font-medium">Tailor a CV to a job posting</span>
            </button>
          </div>
        </section>

        <button
          type="button"
          onClick={() => navigate({ page: 'knowledge' })}
          className="bg-card ring-hairline hover:ring-foreground/20 flex items-center gap-3 rounded-2xl p-4 text-left shadow-[0_1px_2px_rgba(0,0,0,0.04)] ring-1 transition"
        >
          <div className="bg-muted grid size-10 shrink-0 place-items-center rounded-xl">
            <Library className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold">Knowledge base</div>
            <p className="text-muted-foreground text-sm">Your extra projects, skills and facts. What you are looking for is under Job search, the prompts under MCP.</p>
          </div>
          <ArrowRight className="text-muted-foreground size-4 shrink-0" />
        </button>
      </div>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete "${deleting?.name}"?`}
        description="This CV and its translations will be permanently removed."
        confirmLabel="Delete"
        destructive
        onConfirm={() => (deleting ? remove(deleting.id) : undefined)}
      />
    </div>
  )
}
