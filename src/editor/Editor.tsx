import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { Eye, X } from 'lucide-react'
import { toast } from 'sonner'
import { pdfFileName } from '@shared/utils'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/api'
import { PrintPortal } from '@/resume/PrintPortal'
import { ResumePreview } from '@/resume/ResumePreview'
import type { DocProps } from '@/resume/ResumeDocument'
import ApplicationsPage from './applications/ApplicationsPage'
import { useApplications } from './applications/store'
import CommandPalette from './CommandPalette'
import CvsPage from './cvs/CvsPage'
import LettersPage from './letters/LettersPage'
import ProfilePage, { PANELS } from './profile/ProfilePage'
import { navigate, useRoute } from './router'
import { useSidebarShortcut } from './sidebar'
import { useEditor } from './store'
import DemoBanner from './DemoBanner'
import type { DemoSession } from '@/lib/api'
import { checkForChanges, startSync } from './sync'
import TopBar from './TopBar'

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
  const [mobilePreview, setMobilePreview] = useState(false)
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
      {route.page in PANELS && <ProfilePage panel={route.page as keyof typeof PANELS} />}
      {route.page === 'applications' && <ApplicationsPage appId={route.appId} />}
      {route.page === 'letters' && <LettersPage appId={route.appId} />}
      {(route.page === 'cv' || route.page === 'cvs') && <CvsPage cv={cv} preview={previewDoc} />}

      {cv && (
        <Button className="fixed right-4 bottom-4 z-20 rounded-full shadow-lg lg:hidden" onClick={() => setMobilePreview(true)}>
          <Eye /> Preview
        </Button>
      )}
      {cv && mobilePreview && previewDoc && (
        <div className="fixed inset-0 z-30 overflow-y-auto bg-[var(--preview-canvas)] py-4 lg:hidden">
          <Button size="icon" variant="secondary" className="fixed top-3 right-3 z-40 rounded-full shadow" onClick={() => setMobilePreview(false)}>
            <X />
          </Button>
          <ResumePreview {...previewDoc} padding={10} />
        </div>
      )}

      <PrintPortal doc={doc} fileName={fileName} />
      <CommandPalette onLogout={onLogout} />
    </div>
  )
}
