import { useSyncExternalStore } from 'react'

/**
 * Editor URLs, so the browser's back button moves between editor pages instead of leaving the editor:
 *   /edit                           my CVs
 *   /edit/cv/:id                    a CV (content), /customize, /ai
 *   /edit/applications[/:appId]     job applications board (with one application open)
 *   /edit/letters[/:appId]          motivation letters (of one application)
 *   /edit/job-search                job-search profile (/edit/profile, the old address, lands here)
 *   /edit/knowledge                 knowledge base (library)
 *   /edit/mcp                       MCP prompts and connector help (/edit/claude, the old address, lands here)
 */

export type CvTab = 'content' | 'customize' | 'ai'

/** The pages about the person rather than one CV: each is its own panel in the top bar. */
export type PanelPage = 'jobsearch' | 'knowledge' | 'mcp'

export const PANEL_PATHS: Record<PanelPage, string> = { jobsearch: 'job-search', knowledge: 'knowledge', mcp: 'mcp' }

export type Route =
  | { page: 'cvs' }
  | { page: PanelPage }
  | { page: 'applications'; appId: string | null }
  | { page: 'letters'; appId: string | null }
  | { page: 'cv'; id: string; tab: CvTab }

export function parseRoute(pathname: string): Route {
  const parts = pathname
    .replace(/^\/edit\/?/, '')
    .split('/')
    .filter(Boolean)
    .map((p) => {
      try {
        return decodeURIComponent(p)
      } catch {
        return p
      }
    })
  if (parts[0] === 'cv' && parts[1]) {
    const tab: CvTab = parts[2] === 'customize' || parts[2] === 'ai' ? parts[2] : 'content'
    return { page: 'cv', id: parts[1], tab }
  }
  if (parts[0] === 'applications') return { page: 'applications', appId: parts[1] ?? null }
  if (parts[0] === 'letters') return { page: 'letters', appId: parts[1] ?? null }
  if (parts[0] === 'profile') return { page: 'jobsearch' }
  if (parts[0] === 'claude') return { page: 'mcp' }
  const panel = (Object.keys(PANEL_PATHS) as PanelPage[]).find((p) => PANEL_PATHS[p] === parts[0])
  if (panel) return { page: panel }
  return { page: 'cvs' }
}

export function routePath(route: Route): string {
  switch (route.page) {
    case 'cvs':
      return '/edit'
    case 'jobsearch':
    case 'knowledge':
    case 'mcp':
      return `/edit/${PANEL_PATHS[route.page]}`
    case 'applications':
      return route.appId ? `/edit/applications/${encodeURIComponent(route.appId)}` : '/edit/applications'
    case 'letters':
      return route.appId ? `/edit/letters/${encodeURIComponent(route.appId)}` : '/edit/letters'
    case 'cv':
      return `/edit/cv/${encodeURIComponent(route.id)}${route.tab === 'content' ? '' : `/${route.tab}`}`
  }
}

const listeners = new Set<() => void>()
let currentPath = window.location.pathname
let current: Route = parseRoute(currentPath)
// An old address (/edit/profile, /edit/claude) shows the new one.
if (/^\/edit\/(profile|claude)\/?$/.test(currentPath)) {
  currentPath = routePath(current)
  window.history.replaceState(null, '', currentPath)
}

function sync() {
  if (window.location.pathname === currentPath) return
  currentPath = window.location.pathname
  current = parseRoute(currentPath)
  listeners.forEach((l) => l())
}

window.addEventListener('popstate', sync)

/** Pushes a new history entry (or replaces the current one, e.g. for tab switches). */
export function navigate(to: Route, { replace = false }: { replace?: boolean } = {}) {
  const path = routePath(to)
  if (path !== window.location.pathname) window.history[replace ? 'replaceState' : 'pushState'](null, '', path)
  sync()
}

export function getRoute(): Route {
  return current
}

export function useRoute(): Route {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => current,
  )
}

/** Opens a CV, keeping the current tab when already inside a CV. */
export function openCv(id: string, tab?: CvTab) {
  const route = getRoute()
  navigate({ page: 'cv', id, tab: tab ?? (route.page === 'cv' ? route.tab : 'content') })
}

/** Switches the tab of the open CV without adding a history entry. */
export function setCvTab(tab: CvTab) {
  const route = getRoute()
  if (route.page === 'cv') navigate({ ...route, tab }, { replace: true })
}
