import { useState } from 'react'
import {
  Check,
  CloudOff,
  Copy,
  Download,
  FileText,
  Files,
  Loader2,
  LogOut,
  Mail,
  Monitor,
  Moon,
  MoreVertical,
  Paintbrush,
  PencilLine,
  Sparkles,
  SquareKanban,
  Star,
  Sun,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { LANG_LABELS, LANGS, type Application, type Lang } from '@shared/types'
import { isStale } from '@shared/utils'
import { CompanyLogo } from '@/components/CompanyLogo'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { api } from '@/lib/api'
import { useTheme, type ThemeChoice } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { downloadLetterPdf } from '@/resume/download'
import { logoFor, openCvIn, useApplications } from './applications/store'
import { ConfirmDialog, PromptDialog } from './dialogs'
import { PANELS } from './profile/ProfilePage'
import { navigate, openCv, setCvTab, useRoute, type CvTab, type PanelPage } from './router'
import { useEditor } from './store'
import { useDownload } from './useDownload'

const TABS: { id: CvTab; label: string; icon: typeof FileText }[] = [
  { id: 'content', label: 'Content', icon: FileText },
  { id: 'customize', label: 'Customize', icon: Paintbrush },
  { id: 'ai', label: 'AI Tools', icon: Sparkles },
]

const THEMES: { id: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'system', label: 'System', icon: Monitor },
]

function NavButton({
  active,
  icon: Icon,
  label,
  onClick,
  compact,
}: {
  active: boolean
  icon: typeof FileText
  label: string
  onClick: () => void
  /** Icon only until very wide screens (1800 px): the CV tabs and tools share the bar. */
  compact: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      aria-label={label}
      title={label}
      className={cn(
        'text-muted-foreground hover:bg-muted hover:text-foreground flex h-9 items-center gap-2 rounded-lg px-2.5 text-sm font-medium whitespace-nowrap transition-colors sm:px-3',
        active && 'bg-muted text-foreground',
      )}
    >
      <Icon className="size-4" />
      <span className={compact ? 'hidden min-[1800px]:inline' : 'hidden md:inline'}>{label}</span>
    </button>
  )
}

export default function TopBar({ onLogout, user }: { onLogout: () => void; user: string | null }) {
  const route = useRoute()
  const resume = useEditor((s) => s.resume)
  const list = useEditor((s) => s.list)
  const lang = useEditor((s) => s.lang)
  const setLang = useEditor((s) => s.setLang)
  const saveState = useEditor((s) => s.saveState)
  const apps = useApplications((s) => s.items)
  const { theme, setTheme } = useTheme()
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const download = useDownload()

  // Controls for one CV only show while that CV is open.
  const cv = route.page === 'cv' && resume?.id === route.id ? resume : null
  const inCv = route.page === 'cv'
  const masters = list.filter((m) => m.kind === 'master')
  const tailored = list.filter((m) => m.kind === 'tailored')

  const logout = async () => {
    await useEditor.getState().flush()
    await useApplications.getState().flush()
    await api.logout()
    onLogout()
  }

  return (
    <header className="bg-background border-hairline flex h-14 shrink-0 items-center gap-1 border-b px-2 sm:h-16 sm:gap-2 sm:px-4">
      <button
        type="button"
        onClick={() => navigate({ page: 'applications', appId: null })}
        className="focus-visible:ring-ring mr-0.5 shrink-0 rounded-full outline-none focus-visible:ring-2 sm:mr-1.5"
        title="Applications"
        aria-label="Sforza: go to applications"
      >
        <img src="/logo.png" alt="" className="size-8 sm:size-9" />
      </button>
      <nav className="flex items-center gap-0.5 sm:gap-1">
        <NavButton
          compact={inCv}
          active={route.page === 'applications'}
          icon={SquareKanban}
          label="Applications"
          onClick={() => navigate({ page: 'applications', appId: null })}
        />
        <NavButton compact={inCv} active={route.page === 'cvs'} icon={Files} label="My CVs" onClick={() => navigate({ page: 'cvs' })} />
        <NavButton compact={inCv} active={route.page === 'letters'} icon={Mail} label="Letters" onClick={() => navigate({ page: 'letters', appId: null })} />
      </nav>
      {/* On narrow screens, editing a CV needs the room: the three panels stay one tap away on My CVs. */}
      <div className={cn('bg-border mx-0.5 h-6 w-px sm:mx-1.5', inCv && 'hidden lg:block')} aria-hidden />
      <nav className={cn('flex items-center gap-0.5 sm:gap-1', inCv && 'hidden lg:flex')} aria-label="About you">
        {(Object.keys(PANELS) as PanelPage[]).map((p) => (
          <NavButton
            key={p}
            compact={inCv}
            active={route.page === p}
            icon={PANELS[p].icon}
            label={PANELS[p].label}
            onClick={() => navigate({ page: p })}
          />
        ))}
      </nav>

      {route.page === 'cv' && (
        <>
          <div className="bg-border mx-0.5 h-6 w-px sm:mx-1.5" />
          <nav className="flex items-center gap-0.5 sm:gap-1">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setCvTab(id)}
                aria-current={route.tab === id ? 'page' : undefined}
                className={cn(
                  'text-muted-foreground hover:bg-muted hover:text-foreground flex h-9 items-center gap-2 rounded-lg px-2.5 text-sm font-medium whitespace-nowrap transition-colors sm:px-3.5',
                  route.tab === id && 'bg-muted text-foreground',
                )}
              >
                <Icon className="size-4" />
                <span className="hidden xl:inline">{label}</span>
              </button>
            ))}
          </nav>
        </>
      )}

      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        {cv && <SaveIndicator state={saveState} />}

        {cv && (
          <div className="bg-muted hidden items-center rounded-lg p-0.5 sm:flex">
            {LANGS.map((l) => {
              const has = !!cv.content[l]
              const stale = isStale(cv, l)
              return (
                <Tooltip key={l}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => setLang(l)}
                      className={cn(
                        'text-muted-foreground hover:text-foreground relative h-8 rounded-md px-2.5 text-xs font-semibold transition-colors',
                        l === lang && 'bg-background text-foreground shadow-sm',
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
        )}

        {cv && (
          <Select value={cv.id} onValueChange={(id) => openCv(id)}>
            <SelectTrigger className="bg-muted hidden h-9 w-48 xl:flex">
              <SelectValue placeholder="Resume" />
            </SelectTrigger>
            <SelectContent align="end" position="popper" className="max-h-80">
              <SelectGroup>
                <SelectLabel>Master</SelectLabel>
                {masters.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                    {m.isMain && <Star className="size-3 fill-amber-400 text-amber-400" />}
                  </SelectItem>
                ))}
              </SelectGroup>
              {tailored.length > 0 && (
                <SelectGroup>
                  <SelectLabel>Tailored versions</SelectLabel>
                  {tailored.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      <CompanyLogo src={logoFor(apps, m)} name={m.job?.company || m.name} size={18} />
                      {m.name}
                      {m.isMain && <Star className="size-3 fill-amber-400 text-amber-400" />}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
            </SelectContent>
          </Select>
        )}

        {cv && <SendIn app={apps.find((a) => a.resumeId === cv.id && a.lang)} viewing={lang} />}
        {cv && <CvLetters cvId={cv.id} lang={lang} />}
        {route.page === 'letters' && <LetterTools />}

        {cv && (
          <Button onClick={() => void download.run()} disabled={download.busy} className="h-9 gap-2 px-3 sm:px-4">
            <span className="hidden sm:inline">{download.busy ? 'Preparing…' : 'Download'}</span>
            {download.busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
          </Button>
        )}

        <ThemeToggle className="hidden sm:inline-flex" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" className="size-9">
              <MoreVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {cv && !cv.isMain && (
              <DropdownMenuItem
                onClick={() =>
                  void useEditor
                    .getState()
                    .setMain(cv.id)
                    .then(() => toast.success(`"${cv.name}" is now your main CV`))
                }
              >
                <Star /> Make main CV
              </DropdownMenuItem>
            )}
            {cv && (
              <DropdownMenuItem onClick={() => setRenaming(true)}>
                <PencilLine /> Rename
              </DropdownMenuItem>
            )}
            {cv && (
              <DropdownMenuItem
                onClick={async () => {
                  const copy = await useEditor.getState().duplicate(cv.id)
                  openCv(copy.id)
                  toast.success('Duplicated')
                }}
              >
                <Copy /> Duplicate
              </DropdownMenuItem>
            )}
            {cv && cv.kind !== 'master' && (
              <DropdownMenuItem variant="destructive" disabled={cv.isMain} onClick={() => setDeleting(true)}>
                <Trash2 /> Delete
              </DropdownMenuItem>
            )}
            {cv && (
              // On phones the language switch is not in the bar.
              <div className="sm:hidden">
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">CV language</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={lang} onValueChange={(v) => setLang(v as Lang)}>
                  {LANGS.map((l) => (
                    <DropdownMenuRadioItem key={l} value={l}>
                      {LANG_LABELS[l].name}
                      {!cv.content[l] && <span className="text-muted-foreground ml-auto text-xs">not translated</span>}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </div>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">Appearance</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as ThemeChoice)}>
              {THEMES.map(({ id, label, icon: Icon }) => (
                <DropdownMenuRadioItem key={id} value={id} onSelect={(e) => e.preventDefault()}>
                  <Icon /> {label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            {user && <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">Signed in as {user}</DropdownMenuLabel>}
            <DropdownMenuItem onClick={() => void logout()}>
              <LogOut /> Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <PromptDialog
        open={renaming}
        onOpenChange={setRenaming}
        title="Rename CV"
        label="Name"
        initial={cv?.name ?? ''}
        onSubmit={(name) =>
          useEditor.getState().update((d) => {
            d.name = name
          })
        }
      />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete "${cv?.name}"?`}
        description="This tailored CV and its translations will be permanently removed."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!cv) return
          await useEditor.getState().remove(cv.id)
          navigate({ page: 'cvs' }, { replace: true })
        }}
      />
    </header>
  )
}

/** On the Letters page: the CV sent with the open letter and the letter's PDF, where the CV page has Letter and Download. */
function LetterTools() {
  const view = useApplications((s) => s.letterView)
  const app = useApplications((s) => s.items.find((a) => a.id === view?.appId))
  const cvLangs = useEditor((s) => s.list.find((m) => m.id === app?.resumeId)?.langs)
  const [busy, setBusy] = useState(false)
  if (!view || !app) return null
  const letter = app.letters?.[view.lang]
  // The CV in the letter's language when it has one, else in the language set on the card.
  const cvLang = cvLangs?.includes(view.lang) ? view.lang : app.lang

  const download = async () => {
    setBusy(true)
    try {
      await useApplications.getState().flush()
      await downloadLetterPdf(app.id, view.lang)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SendIn app={app} viewing={view.lang} />
      {app.resumeId && (
        <Button variant="outline" onClick={() => openCvIn(app.resumeId!, cvLang)} title="Open the CV sent with this letter" className="h-9 gap-2 px-3">
          <FileText className="size-4" />
          <span className="hidden 2xl:inline">CV</span>
        </Button>
      )}
      {letter && (
        <Button onClick={() => void download()} disabled={busy} className="h-9 gap-2 px-3 sm:px-4">
          <span className="hidden sm:inline">{busy ? 'Preparing…' : 'Download'}</span>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
        </Button>
      )}
    </>
  )
}

/** The language to send for this application (the card's language): highlighted while another version is open. */
function SendIn({ app, viewing }: { app: Application | undefined; viewing: Lang }) {
  if (!app?.lang) return null
  const other = viewing !== app.lang
  return (
    <span
      title={other ? `You are viewing the ${LANG_LABELS[viewing].name} version; send the ${LANG_LABELS[app.lang].name} one` : 'The version to send'}
      className={cn(
        'hidden h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium whitespace-nowrap md:flex',
        other ? 'border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400' : 'text-muted-foreground',
      )}
    >
      {LANG_LABELS[app.lang].flag} Preferably send in {LANG_LABELS[app.lang].name}
    </span>
  )
}

/** The motivation letters of the applications this CV is for, one click away from the CV. */
function CvLetters({ cvId, lang }: { cvId: string; lang: Lang }) {
  const items = useApplications((s) => s.items)
  const apps = items.filter((a) => a.resumeId === cvId && LANGS.some((l) => a.letters?.[l]))
  if (!apps.length) return null
  const open = (a: Application) => {
    // The letter in the CV's language when there is one.
    const l = a.letters?.[lang] ? lang : (LANGS.find((x) => a.letters?.[x]) ?? lang)
    useApplications.setState({ letterFocus: { appId: a.id, lang: l } })
    navigate({ page: 'letters', appId: a.id })
  }
  const label = (
    <>
      <Mail className="size-4" />
      <span className="hidden 2xl:inline">Letter</span>
    </>
  )
  if (apps.length === 1) {
    return (
      <Button variant="outline" onClick={() => open(apps[0])} title={`Motivation letter for ${apps[0].company || apps[0].title}`} className="h-9 gap-2 px-3">
        {label}
      </Button>
    )
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" title="Motivation letters sent with this CV" className="h-9 gap-2 px-3">
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {apps.map((a) => (
          <DropdownMenuItem key={a.id} onClick={() => open(a)}>
            <CompanyLogo src={a.logo} name={a.company || a.title} size={18} />
            <span className="min-w-0 truncate">{[a.company, a.title].filter(Boolean).join(' – ')}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SaveIndicator({ state }: { state: string }) {
  if (state === 'idle') return null
  return (
    <span className="text-muted-foreground hidden items-center gap-1.5 text-xs md:flex">
      {state === 'saving' && <Loader2 className="size-3.5 animate-spin" />}
      {state === 'saved' && <Check className="size-3.5 text-emerald-600 dark:text-emerald-500" />}
      {state === 'error' && <CloudOff className="text-destructive size-3.5" />}
      <span className="hidden xl:inline">{state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : 'Not saved'}</span>
    </span>
  )
}
