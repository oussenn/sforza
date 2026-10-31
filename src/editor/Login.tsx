import { useState, type FormEvent } from 'react'
import { ArrowRight } from 'lucide-react'
import { PASSWORD_MIN, passwordProblem, usernameProblem } from '@shared/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'

/**
 * Sign in, or make an account: the first one of a new deployment (setup) or one from an invitation link (join).
 * New passwords are checked here and again on the server, which stores only a salted hash.
 */
export type LoginMode = { kind: 'signin' } | { kind: 'setup'; needsToken: boolean } | { kind: 'join'; code: string }

const TEXT: Record<LoginMode['kind'], { subtitle: string; button: string; intro?: string }> = {
  signin: { subtitle: 'Sign in to your account', button: 'Sign in' },
  setup: {
    subtitle: 'Create your account',
    button: 'Create account',
    intro: 'This site has no account yet. The first one can invite others.',
  },
  join: { subtitle: 'You are invited', button: 'Create account', intro: 'Pick a username and a password for your account.' },
}

export default function Login({ mode, onSuccess }: { mode: LoginMode; onSuccess: (user: string) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [setupToken, setSetupToken] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const creating = mode.kind !== 'signin'
  const text = TEXT[mode.kind]

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    const user = username.trim().toLowerCase()
    if (creating) {
      const problem = usernameProblem(user) ?? passwordProblem(password, user) ?? (password !== confirm ? 'The two passwords differ.' : null)
      if (problem) return setError(problem)
    }
    setBusy(true)
    try {
      const result =
        mode.kind === 'setup'
          ? await api.setup(user, password, setupToken)
          : mode.kind === 'join'
            ? await api.join(mode.code, user, password)
            : await api.login(username, password)
      onSuccess(result.user)
    } catch (err) {
      setError((err as Error).message)
      if (!creating) setPassword('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <form onSubmit={submit} className="bg-card ring-hairline w-full max-w-sm rounded-2xl p-7 shadow-2xl ring-1">
        <div className="mb-6 flex items-center gap-3">
          <img src="/logo.png" alt="" className="size-11" />
          <div>
            <h1 className="text-base font-semibold">Sforza</h1>
            <p className="text-muted-foreground text-sm">{text.subtitle}</p>
          </div>
        </div>
        {text.intro && <p className="text-muted-foreground -mt-2 mb-5 text-sm">{text.intro}</p>}
        {mode.kind === 'join' && !mode.code ? (
          <p role="alert" className="text-destructive text-sm">
            This invitation link is incomplete. Open the whole link again.
          </p>
        ) : (
          <div className="grid gap-4">
            {mode.kind === 'setup' && mode.needsToken && (
              <div className="grid gap-1.5">
                <Label htmlFor="login-setup">Setup token</Label>
                <Input
                  id="login-setup"
                  name="setup-token"
                  type="password"
                  autoComplete="off"
                  value={setupToken}
                  onChange={(e) => setSetupToken(e.target.value)}
                  className="h-10"
                />
                <p className="text-muted-foreground text-xs">The SETUP_TOKEN secret set on the Worker.</p>
              </div>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="login-user">Username</Label>
              <Input
                id="login-user"
                name="username"
                autoFocus
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="h-10"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="login-password">Password</Label>
              <Input
                id="login-password"
                name="password"
                type="password"
                autoComplete={creating ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={!!error}
                className="h-10"
              />
              {creating && <p className="text-muted-foreground text-xs">At least {PASSWORD_MIN} characters. A passphrase of a few words works well.</p>}
            </div>
            {creating && (
              <div className="grid gap-1.5">
                <Label htmlFor="login-confirm">Repeat the password</Label>
                <Input
                  id="login-confirm"
                  name="confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="h-10"
                />
              </div>
            )}
            <Button type="submit" disabled={busy || !username || !password || (creating && !confirm)} className="h-10">
              {text.button} <ArrowRight />
            </Button>
          </div>
        )}
        {error && (
          <p role="alert" className="text-destructive mt-3 text-sm">
            {error}
          </p>
        )}
      </form>
    </div>
  )
}
