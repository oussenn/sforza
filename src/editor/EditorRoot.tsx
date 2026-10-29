import { useEffect, useState } from 'react'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { api } from '@/lib/api'
import Editor from './Editor'
import Login from './Login'

export default function EditorRoot() {
  const [auth, setAuth] = useState<'checking' | 'in' | 'out'>('checking')
  const [user, setUser] = useState<string | null>(null)

  useEffect(() => {
    document.title = 'Sforza'
    api
      .me()
      .then((r) => {
        // An old address of this site: continue on the main one, same page.
        if (r.moveTo) return window.location.replace(r.moveTo + window.location.pathname + window.location.search + window.location.hash)
        setUser(r.user)
        setAuth(r.authenticated ? 'in' : 'out')
      })
      .catch(() => setAuth('out'))
  }, [])

  // A full reload drops everything the previous account had loaded into memory.
  const signedOut = () => window.location.replace('/')

  return (
    <TooltipProvider delayDuration={300}>
      {auth === 'checking' && <div className="min-h-dvh bg-[var(--preview-canvas)]" />}
      {auth === 'out' && (
        <Login
          onSuccess={(name) => {
            setUser(name)
            setAuth('in')
          }}
        />
      )}
      {auth === 'in' && <Editor onLogout={signedOut} user={user} />}
      <Toaster position="bottom-center" richColors closeButton />
    </TooltipProvider>
  )
}
