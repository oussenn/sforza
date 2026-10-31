import { useEffect, useState } from 'react'
import { Backdrop } from '@/components/Backdrop'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { api } from '@/lib/api'
import Editor from './Editor'
import Login, { type LoginMode } from './Login'
import { navigate } from './router'

/**
 * An invitation link is /join#<code>. The code leaves the address bar at once (it stays in this tab's history
 * state, so a reload still works) and is never sent to the server in a URL.
 */
function readJoinCode(): string | null {
  if (window.location.pathname !== '/join') return null
  const code = window.location.hash.slice(1) || (window.history.state as { joinCode?: string } | null)?.joinCode || ''
  window.history.replaceState({ joinCode: code }, '', '/join')
  return code
}

export default function EditorRoot() {
  const [auth, setAuth] = useState<'checking' | 'in' | 'out'>('checking')
  const [user, setUser] = useState<string | null>(null)
  const [setup, setSetup] = useState<{ needsToken: boolean } | null>(null)
  const [joinCode, setJoinCode] = useState(readJoinCode)
  // The backdrop blurs with motion only after the sign-in page was on screen; a signed-in visit starts blurred.
  const [animate, setAnimate] = useState(false)

  useEffect(() => {
    document.title = 'Sforza'
    api
      .me()
      .then((r) => {
        // An old address of this site: continue on the main one, same page.
        if (r.moveTo) return window.location.replace(r.moveTo + window.location.pathname + window.location.search + window.location.hash)
        setUser(r.user)
        setSetup(r.setup ?? null)
        setAnimate(!r.authenticated)
        setAuth(r.authenticated ? 'in' : 'out')
      })
      .catch(() => {
        setAnimate(true)
        setAuth('out')
      })
  }, [])

  // A full reload drops everything the previous account had loaded into memory.
  const signedOut = () => window.location.replace('/')

  const signedIn = (name: string) => {
    setUser(name)
    setSetup(null)
    setAuth('in')
  }

  const joined = (name: string) => {
    // Someone else was signed in here: start from a clean page rather than their loaded data.
    if (auth === 'in') return window.location.replace('/')
    setJoinCode(null)
    navigate({ page: 'cvs' }, { replace: true })
    signedIn(name)
  }

  const mode: LoginMode = setup ? { kind: 'setup', needsToken: setup.needsToken } : { kind: 'signin' }
  const inEditor = auth === 'in' && joinCode === null

  return (
    <TooltipProvider delayDuration={300}>
      {auth === 'checking' ? <div className="min-h-dvh bg-[var(--preview-canvas)]" /> : <Backdrop blurred={inEditor} animate={animate} />}
      {/* A new account from an invitation replaces any session in this browser. */}
      {auth !== 'checking' && joinCode !== null && <Login mode={{ kind: 'join', code: joinCode }} onSuccess={joined} />}
      {auth === 'out' && joinCode === null && <Login mode={mode} onSuccess={signedIn} />}
      {inEditor && <Editor onLogout={signedOut} user={user} />}
      <Toaster position="bottom-center" richColors closeButton />
    </TooltipProvider>
  )
}
