import { Suspense, lazy } from 'react'
import PrintPage from '@/print/PrintPage'

const EditorRoot = lazy(() => import('@/editor/EditorRoot'))

export default function App() {
  if (window.location.pathname === '/print') return <PrintPage />
  // Nothing is public: every other address opens the editor, which asks to sign in first.
  if (!/^\/edit(\/|$)/.test(window.location.pathname)) window.history.replaceState(null, '', '/edit')
  return (
    <Suspense fallback={<div className="min-h-dvh bg-[var(--preview-canvas)]" />}>
      <EditorRoot />
    </Suspense>
  )
}
