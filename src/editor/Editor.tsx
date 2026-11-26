import { Suspense, lazy, useDeferredValue, useEffect, useMemo } from 'react'
import { toast } from 'sonner'
import { pdfFileName } from '@shared/utils'
import { ApiError } from '@/lib/api'
import { PrintPortal } from '@/resume/PrintPortal'
import type { DocProps } from '@/resume/ResumeDocument'
import ApplicationsPage from './applications/ApplicationsPage'
import { useApplications } from './applications/store'
import CommandPalette from './CommandPalette'
import { PANELS } from './profile/panels'
import { navigate, useRoute, type PanelPage } from './router'
import { useSession } from './session'
import { useSidebarShortcut } from './sidebar'
import { useEditor } from './store'
import DemoBanner from './DemoBanner'
import type { DemoSession } from '@/lib/api'
import { checkForChanges, startSync } from './sync'
import TopBar from './TopBar'

// The board opens first and comes with the editor; the other pages load on their first visit, and in the background
// once the board is up, so switching to them stays instant.
const loadCvs = () => import('./cvs/CvsPage')
const loadLetters = () => import('./letters/LettersPage')
const loadProfile = () => import('./profile/ProfilePage')
const loadTour = () => import('./Tour')
const CvsPage = lazy(loadCvs)
const LettersPage = lazy(loadLetters)
const ProfilePage = lazy(loadProfile)
const Tour = lazy(loadTour)

const Spinner = () => (
  <div className="grid flex-1 place-items-center">
    <div className="border-muted border-t-foreground size-6 animate-spin rounded-full border-2" />
  </div>
)

export default function Editor({ onLogout, user, demo = null }: { onLogout: () => void; user: string | null; demo?: DemoSession | null }) {
  const route = useRoute()
  const ready = useEditor((s) => s.ready)
  const resume = useEditor((s) => s.resume)
  const list = useEditor((s) => s.list)
  const lang = useEditor((s) => s.lang)
  useSidebarShortcut(route.page === 'cv' || route.page === 'cvs' || route.page === 'letters')

  useEffect(() => {
    useEditor
      .getState()
      .init()
      .catch((err: Error) => toast.error(err.message))
    useApplications
      .getState()
      .load()
      .catch((err: Error) => toast.error(`Could not load applications: ${err.message}`))
  }, [])

  useEffect(() => {
    if (!ready) return
    const prefetch = () => void Promise.all([loadCvs(), loadLetters(), loadProfile(), loadTour()]).catch(() => undefined)
    const idle = window.requestIdleCallback?.(prefetch, { timeout: 4000 }) ?? window.setTimeout(prefetch, 2500)
    return () => (window.cancelIdleCallback ? window.cancelIdleCallback(idle) : clearTimeout(idle))
  }, [ready])

  // The welcome tour, once per account (new accounts and members who joined before it existed alike).
  const touring = useSession((s) => s.touring)
  const tourSeen = useSession((s) => s.tourSeen)
  useEffect(() => {
    if (!ready || tourSeen) return
    const t = setTimeout(() => useSession.setState({ touring: true }), 900)
    return () => clearTimeout(t)
  }, [ready, tourSeen])

  // Changes made elsewhere (the connector, another tab) show up without a reload, also on every page change.
  useEffect(() => (ready ? startSync() : undefined), [ready])
  useEffect(() => {
    if (ready) void checkForChanges()
  }, [ready, route])

  // The CV in the URL is the one being edited.
  const wantedId = route.page === 'cv' ? route.id : null
  useEffect(() => {
    if (!ready || !wantedId || useEditor.getState().resume?.id === wantedId) return
    useEditor
      .getState()
      .open(wantedId)
      .catch((err: Error) => {
        toast.error(err instanceof ApiError && err.status === 404 ? 'That CV no longer exists.' : err.message)
        navigate({ page: 'cvs' }, { replace: true })
      })
  }, [ready, wantedId])

  // My CVs opens a CV right away, as My Cover Letters opens a letter: the one open last, else the main CV.
  useEffect(() => {
    if (!ready || route.page !== 'cvs' || !list.length) return
    const last = useEditor.getState().resume?.id
    const pick = list.find((m) => m.id === last) ?? list.find((m) => m.isMain) ?? list.find((m) => m.kind === 'master') ?? list[0]
    navigate({ page: 'cv', id: pick.id, tab: 'content' }, { replace: true })
  }, [ready, route.page, list])

  const cv = route.page === 'cv' && resume?.id === route.id ? resume : null

  useEffect(() => {
    const page =
      route.page === 'cvs'
        ? 'My CVs'
        : route.page === 'applications'
          ? 'Applications'
          : route.page === 'letters'
            ? 'My Cover Letters'
            : route.page === 'cv'
            ? (cv?.name ?? 'CV')
            : PANELS[route.page].label
    document.title = `${page} · Sforza`
  }, [route.page, cv?.name])

  const content = cv ? (cv.content[lang] ?? cv.content[cv.sourceLang]) : undefined
  const doc = useMemo<DocProps | null>(
    () =>
      cv && content
        ? { template: cv.template, style: cv.style, photo: cv.photo, content, lang: cv.content[lang] ? lang : cv.sourceLang }
        : null,
    [cv, content, lang],
  )
  // Keep typing snappy: the preview re-renders at lower priority.
  const previewDoc = useDeferredValue(doc)

  const fileName = cv ? pdfFileName(cv, cv.content[lang] ? lang : cv.sourceLang) : 'Resume'

  if (!ready) {
    return (
      <div className="flex min-h-dvh">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="flex h-dvh flex-col">
      {demo && <DemoBanner expiresAt={demo.expiresAt} />}
      <TopBar onLogout={onLogout} user={user} demo={!!demo} />
      {route.page === 'applications' && <ApplicationsPage appId={route.appId} />}
      <Suspense fallback={<Spinner />}>
        {route.page in PANELS && <ProfilePage panel={route.page as PanelPage} />}
        {route.page === 'letters' && <LettersPage appId={route.appId} />}
        {(route.page === 'cv' || route.page === 'cvs') && <CvsPage cv={cv} preview={previewDoc} />}
      </Suspense>
      {touring && (
        <Suspense fallback={null}>
          <Tour />
        </Suspense>
      )}

      <PrintPortal doc={doc} fileName={fileName} />
      <CommandPalette onLogout={onLogout} />
    </div>
  )
}
