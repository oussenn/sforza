import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { Eye, X } from 'lucide-react'
import { toast } from 'sonner'
import { pdfFileName } from '@shared/utils'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/api'
import { PrintPortal } from '@/resume/PrintPortal'
import { ResumePreview } from '@/resume/ResumePreview'
import type { DocProps } from '@/resume/ResumeDocument'
import AiPanel from './ai/AiPanel'
import ApplicationsPage from './applications/ApplicationsPage'
import { useApplications } from './applications/store'
import CommandPalette from './CommandPalette'
import ContentPanel from './content/ContentPanel'
import CustomizePanel from './customize/CustomizePanel'
import JobStrip from './JobStrip'
import Overview from './overview/Overview'
import LettersPage from './letters/LettersPage'
import ProfilePage, { PANELS } from './profile/ProfilePage'
import { navigate, useRoute } from './router'
import { useEditor } from './store'
import { checkForChanges, startSync } from './sync'
import TopBar from './TopBar'

const Spinner = () => (
  <div className="grid flex-1 place-items-center">
    <div className="border-muted border-t-foreground size-6 animate-spin rounded-full border-2" />
  </div>
)

export default function Editor({ onLogout, user }: { onLogout: () => void; user: string | null }) {
  const route = useRoute()
  const ready = useEditor((s) => s.ready)
  const resume = useEditor((s) => s.resume)
  const lang = useEditor((s) => s.lang)
  const [mobilePreview, setMobilePreview] = useState(false)

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

  const cv = route.page === 'cv' && resume?.id === route.id ? resume : null

  useEffect(() => {
    const page =
      route.page === 'cvs'
        ? 'My CVs'
        : route.page === 'applications'
          ? 'Applications'
          : route.page === 'letters'
            ? 'Letters'
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
      <TopBar onLogout={onLogout} user={user} />
      {route.page === 'cvs' && <Overview />}
      {(route.page === 'jobsearch' || route.page === 'knowledge' || route.page === 'mcp') && <ProfilePage panel={route.page} />}
      {route.page === 'applications' && <ApplicationsPage appId={route.appId} />}
      {route.page === 'letters' && <LettersPage appId={route.appId} />}
      {route.page === 'cv' &&
        (cv ? (
          <div className="flex min-h-0 flex-1">
            <aside className="w-full shrink-0 overflow-y-auto px-3 pt-3 pb-24 md:w-[46%] md:max-w-[580px] lg:px-4">
              {route.tab !== 'ai' && <JobStrip />}
              {route.tab === 'content' && <ContentPanel />}
              {route.tab === 'customize' && <CustomizePanel />}
              {route.tab === 'ai' && <AiPanel />}
            </aside>
            <main className="hidden min-w-0 flex-1 overflow-y-auto py-6 md:block">
              {previewDoc && <ResumePreview {...previewDoc} maxScale={1.1} padding={28} />}
            </main>
          </div>
        ) : (
          <Spinner />
        ))}

      {cv && (
        <Button className="fixed right-4 bottom-4 z-20 rounded-full shadow-lg md:hidden" onClick={() => setMobilePreview(true)}>
          <Eye /> Preview
        </Button>
      )}
      {cv && mobilePreview && previewDoc && (
        <div className="fixed inset-0 z-30 overflow-y-auto bg-[var(--preview-canvas)] py-4 md:hidden">
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
