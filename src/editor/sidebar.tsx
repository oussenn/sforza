import { useEffect, useSyncExternalStore, type ReactNode } from 'react'
import { PanelLeftClose, PanelLeftOpen, Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/**
 * The list on the left of My CVs and My Cover Letters. Ctrl+B (⌘B on a Mac) hides and shows it on both pages, and the
 * choice is remembered in this browser. The app takes the key before the browser or the system does (Firefox's
 * bookmarks, the Mac's "back one character"); only a rich text field keeps it for bold.
 */

const KEY = 'sidebar'
const listeners = new Set<() => void>()

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === 'hidden'
  } catch {
    return false
  }
}

let hidden = read()

export function toggleSidebar() {
  hidden = !hidden
  try {
    localStorage.setItem(KEY, hidden ? 'hidden' : 'shown')
  } catch {
    // Private mode: the choice lasts until the page is reloaded.
  }
  listeners.forEach((l) => l())
}

export function useSidebarHidden(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => hidden,
  )
}

const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
export const SIDEBAR_SHORTCUT = mac ? '⌘B' : 'Ctrl+B'

/**
 * Ctrl+B or ⌘B. The letter on the key decides, so a French or German keyboard works as a US one does; a keyboard
 * without Latin letters (Arabic, Russian) uses the key where B sits.
 */
export function isSidebarShortcut(e: KeyboardEvent): boolean {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return false
  const key = e.key.length === 1 ? e.key.toLowerCase() : ''
  return /^[a-z]$/.test(key) ? key === 'b' : e.code === 'KeyB'
}

/** Listens for the shortcut while a page with the list is open. Capture phase: it runs before any field's own handler. */
export function useSidebarShortcut(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (!isSidebarShortcut(e)) return
      if (e.target instanceof Element && e.target.closest('[data-bold-shortcut]')) return
      e.preventDefault()
      e.stopPropagation()
      if (!e.repeat) toggleSidebar()
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [enabled])
}

/** The button that hides and shows the list, at the start of the page's header. */
export function SidebarToggle({ className }: { className?: string }) {
  const isHidden = useSidebarHidden()
  const label = isHidden ? 'Show the list' : 'Hide the list'
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" onClick={toggleSidebar} aria-label={label} aria-keyshortcuts={mac ? 'Meta+B' : 'Control+B'} className={cn('text-muted-foreground shrink-0', className)}>
          {isHidden ? <PanelLeftOpen /> : <PanelLeftClose />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {label}
        <kbd className="bg-background/20 ml-2 rounded px-1 font-sans text-[11px]">{SIDEBAR_SHORTCUT}</kbd>
      </TooltipContent>
    </Tooltip>
  )
}

/** Search, a New button and the list. Slides away when hidden; on phones it sits above the page and folds up. */
export function ListSidebar({
  query,
  onQuery,
  placeholder,
  onNew,
  newTitle,
  label,
  children,
}: {
  query: string
  onQuery: (q: string) => void
  placeholder: string
  onNew: () => void
  newTitle: string
  label: string
  children: ReactNode
}) {
  const isHidden = useSidebarHidden()
  return (
    <aside
      aria-label={label}
      inert={isHidden}
      className={cn(
        'border-hairline flex shrink-0 flex-col overflow-hidden transition-[width,max-height,opacity,border-width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none',
        isHidden
          ? 'max-h-0 border-b-0 opacity-0 lg:max-h-none lg:w-0 lg:border-r-0'
          : 'max-h-[38vh] border-b lg:max-h-none lg:w-72 lg:border-r lg:border-b-0',
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col lg:w-72">
        <div className="flex items-center gap-2 p-3">
          <div className="relative flex-1">
            <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <Input value={query} onChange={(e) => onQuery(e.target.value)} placeholder={placeholder} className="h-9 pl-8" />
          </div>
          <Button size="sm" onClick={onNew} title={newTitle}>
            <Plus /> New
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">{children}</div>
      </div>
    </aside>
  )
}

/** One entry of the list: a link, so Ctrl/⌘-click or a middle click opens it in a new tab. */
export function SidebarRow({
  href,
  onOpen,
  active,
  media,
  title,
  badge,
  subtitle,
  meta,
}: {
  href: string
  onOpen: () => void
  active: boolean
  media: ReactNode
  title: string
  /** Shown after the title, e.g. the star of the main CV. */
  badge?: ReactNode
  subtitle: string
  meta: ReactNode
}) {
  return (
    <a
      href={href}
      onClick={(e) => {
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return
        e.preventDefault()
        onOpen()
      }}
      aria-current={active ? 'true' : undefined}
      className={cn('hover:bg-muted focus-visible:ring-ring flex w-full items-center gap-2.5 rounded-lg p-2 text-left outline-none focus-visible:ring-2', active && 'bg-muted')}
    >
      {media}
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1 text-sm font-medium">
          <span className="truncate">{title}</span>
          {badge}
        </span>
        <span className="text-muted-foreground block truncate text-xs">{subtitle}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">{meta}</span>
    </a>
  )
}
