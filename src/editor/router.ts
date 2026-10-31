import { useSyncExternalStore } from 'react'

/**
 * Editor URLs, so the browser's back button moves between editor pages instead of leaving the editor:
 *   /                          → /applications
 *   /applications[/:appId]     job applications board (with one application open)
 *   /letters[/:appId]          motivation letters (of one application)
 *   /cvs                       my CVs
 *   /cv/:id                    a CV (content), /customize, /ai
 *   /job-search                job-search profile
 *   /knowledge                 knowledge base (library)
 *   /connector                 MCP prompts and connector help (/mcp itself is the connector endpoint)
 * Old /edit/... addresses (links in earlier connector answers and card notes) open the same page without /edit.
 */

export type CvTab = 'content' | 'customize' | 'ai'

/** The pages about the person rather than one CV: each is its own panel in the top bar. */
export type PanelPage = 'jobsearch' | 'knowledge' | 'mcp'

const PANEL_PATHS: Record<PanelPage, string> = { jobsearch: 'job-search', knowledge: 'knowledge', mcp: 'connector' }

export type Route =
  | { page: 'cvs' }
  | { page: PanelPage }
  | { page: 'applications'; appId: string | null }
  | { page: 'letters'; appId: string | null }
  | { page: 'cv'; id: string; tab: CvTab }

export function parseRoute(pathname: string): Route {
  const parts = pathname
    .replace(/^\/edit(?=\/|$)/, '')
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
  if (parts[0] === 'cvs') return { page: 'cvs' }
  if (parts[0] === 'letters') return { page: 'letters', appId: parts[1] ?? null }
  const panel = (Object.keys(PANEL_PATHS) as PanelPage[]).find((p) => PANEL_PATHS[p] === parts[0])
  if (panel) return { page: panel }
  // The board is the home page; any unknown address lands there too.
  return { page: 'applications', appId: parts[0] === 'applications' ? (parts[1] ?? null) : null }
}

export function routePath(route: Route): string {
  switch (route.page) {
    case 'cvs':
      return '/cvs'
    case 'jobsearch':
    case 'knowledge':
    case 'mcp':
      return `/${PANEL_PATHS[route.page]}`
    case 'applications':
    case 'letters':
      return route.appId ? `/${route.page}/${encodeURIComponent(route.appId)}` : `/${route.page}`
    case 'cv':
      return `/cv/${encodeURIComponent(route.id)}${route.tab === 'content' ? '' : `/${route.tab}`}`
  }
}

const listeners = new Set<() => void>()
let currentPath = window.location.pathname
let current: Route = parseRoute(currentPath)
// /, an old /edit/... address or an unknown one shows the page's own address (/join keeps its own: EditorRoot reads it).
if (currentPath !== '/join' && currentPath !== routePath(current)) {
  currentPath = routePath(current)
  window.history.replaceState(window.history.state, '', currentPath + window.location.search + window.location.hash)
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

function getRoute(): Route {
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
