import { useEffect, useState } from 'react'
import {
  Download,
  FileText,
  Files,
  Languages,
  LogOut,
  Mail,
  Monitor,
  Moon,
  Paintbrush,
  Plus,
  Sparkles,
  SquareKanban,
  Star,
  Sun,
} from 'lucide-react'
import { LANG_LABELS, LANGS } from '@shared/types'
import { CompanyLogo } from '@/components/CompanyLogo'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command'
import { api } from '@/lib/api'
import { setTheme } from '@/lib/theme'
import { useStageLabel } from './applications/stages'
import { logoFor, useApplications } from './applications/store'
import { PANELS } from './profile/ProfilePage'
import { navigate, openCv, setCvTab, useRoute, type PanelPage } from './router'
import { useEditor } from './store'
import { useDownload } from './useDownload'

/** Ctrl/Cmd+K inside the editor. */
export default function CommandPalette({ onLogout }: { onLogout: () => void }) {
  const [open, setOpen] = useState(false)
  const route = useRoute()
  const list = useEditor((s) => s.list)
  const resume = useEditor((s) => s.resume)
  const apps = useApplications((s) => s.items)
  const stageLabel = useStageLabel()
  const download = useDownload()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const run = (fn: () => void | Promise<void>) => () => {
    setOpen(false)
    void fn()
  }
  const inCv = route.page === 'cv'
  const master = list.find((m) => m.kind === 'master') ?? list[0]

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Command palette">
      <Command>
        <CommandInput placeholder="Jump to a CV, an application or an action…" />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>
          <CommandGroup heading="Go to">
            <CommandItem onSelect={run(() => navigate({ page: 'cvs' }))}>
              <Files /> My CVs
            </CommandItem>
            <CommandItem onSelect={run(() => navigate({ page: 'applications', appId: null }))}>
              <SquareKanban /> Applications
            </CommandItem>
            <CommandItem onSelect={run(() => navigate({ page: 'letters', appId: null }))}>
              <Mail /> Letters
            </CommandItem>
            {(Object.keys(PANELS) as PanelPage[]).map((p) => {
              const Icon = PANELS[p].icon
              return (
                <CommandItem key={p} onSelect={run(() => navigate({ page: p }))}>
                  <Icon /> {PANELS[p].label}
                </CommandItem>
              )
            })}
            {inCv && (
              <>
                <CommandItem onSelect={run(() => setCvTab('content'))}>
                  <FileText /> Content
                </CommandItem>
                <CommandItem onSelect={run(() => setCvTab('customize'))}>
                  <Paintbrush /> Customize
                </CommandItem>
                <CommandItem onSelect={run(() => setCvTab('ai'))}>
                  <Sparkles /> AI Tools
                </CommandItem>
              </>
            )}
            {master && (
              <CommandItem onSelect={run(() => openCv(master.id, 'ai'))}>
                <Plus /> New tailored CV
              </CommandItem>
            )}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Open CV">
            {list.map((m) => (
              <CommandItem key={m.id} value={`cv ${m.name} ${m.job?.title ?? ''} ${m.job?.company ?? ''}`} onSelect={run(() => openCv(m.id))}>
                {m.kind === 'tailored' ? <CompanyLogo src={logoFor(apps, m)} name={m.job?.company || m.name} size={16} /> : <FileText />}
                {m.name}
                {m.isMain && <Star className="fill-amber-400 text-amber-400" />}
                {inCv && m.id === resume?.id && <CommandShortcut>current</CommandShortcut>}
              </CommandItem>
            ))}
          </CommandGroup>
          {apps.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Applications">
                {apps.map((a) => (
                  <CommandItem
                    key={a.id}
                    value={`application ${a.title} ${a.company} ${a.id}`}
                    onSelect={run(() => navigate({ page: 'applications', appId: a.id }))}
                  >
                    <CompanyLogo src={a.logo} name={a.company || a.title} size={16} />
                    <span className="truncate">
                      {a.title}
                      {a.company && <span className="text-muted-foreground"> · {a.company}</span>}
                    </span>
                    <CommandShortcut>{stageLabel(a.stage)}</CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
          {inCv && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Language">
                {LANGS.map((l) => (
                  <CommandItem key={l} value={`language ${LANG_LABELS[l].name}`} onSelect={run(() => useEditor.getState().setLang(l))}>
                    <Languages /> {LANG_LABELS[l].name}
                    <CommandShortcut>{LANG_LABELS[l].short}</CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
          <CommandSeparator />
          <CommandGroup heading="Actions">
            {inCv && (
              <CommandItem onSelect={run(() => download.run())}>
                <Download /> Download PDF
              </CommandItem>
            )}
            <CommandItem value="theme light mode" onSelect={run(() => setTheme('light'))}>
              <Sun /> Light mode
            </CommandItem>
            <CommandItem value="theme dark mode" onSelect={run(() => setTheme('dark'))}>
              <Moon /> Dark mode
            </CommandItem>
            <CommandItem value="theme system mode" onSelect={run(() => setTheme('system'))}>
              <Monitor /> Theme: follow the system
            </CommandItem>
            <CommandItem
              onSelect={run(async () => {
                await useEditor.getState().flush()
                await useApplications.getState().flush()
                await api.logout()
                onLogout()
              })}
            >
              <LogOut /> Log out
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
