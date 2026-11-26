import { useState, type FormEvent } from 'react'
import { ArrowLeft, ArrowRight, MailCheck } from 'lucide-react'
import { PASSWORD_MIN, passwordProblem, usernameProblem } from '@shared/utils'
import { Logo } from '@/components/Logo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { api, type DemoSession } from '@/lib/api'

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

const README_DEMO = 'https://github.com/oussenn/sforza#try-the-demo'

export default function Login({
  mode,
  onSuccess,
  demoAvailable = false,
}: {
  mode: LoginMode
  onSuccess: (user: string, demo?: DemoSession) => void
  demoAvailable?: boolean
}) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [setupToken, setSetupToken] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const creating = mode.kind !== 'signin'
  const text = TEXT[mode.kind]
  const [asking, setAsking] = useState(false)

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
      onSuccess(result.user, (result as { demo?: DemoSession }).demo)
    } catch (err) {
      setError((err as Error).message)
      if (!creating) setPassword('')
    } finally {
      setBusy(false)
    }
  }

  if (asking) return <RequestAccess onBack={() => setAsking(false)} />

  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <form onSubmit={submit} className="bg-card ring-hairline w-full max-w-sm rounded-2xl p-7 shadow-2xl ring-1">
        <div className="mb-6 flex items-center gap-3">
          <Logo className="size-11" />
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
        {mode.kind === 'signin' && (
          <p className="text-muted-foreground mt-5 text-center text-sm">
            No account yet?{' '}
            <button type="button" onClick={() => setAsking(true)} className="text-foreground font-medium underline underline-offset-2">
              Request access
            </button>
          </p>
        )}
        {mode.kind === 'signin' && demoAvailable && (
          <p className="text-muted-foreground mt-5 border-t pt-4 text-xs">
            Just looking? Sign in as <span className="text-foreground font-mono">demo</span> with the password from the{' '}
            <a href={README_DEMO} target="_blank" rel="noreferrer" className="underline underline-offset-2">
              README
            </a>
            . You get your own copy of sample data for two hours.
          </p>
        )}
      </form>
    </div>
  )
}

/**
 * Asking for an account: an email address, and optionally a name and a few words, for the admin of this site, who
 * answers with an invitation by mail. The answer is the same whether the address asked before or not.
 */
function RequestAccess({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  // Left empty by people; form-filling bots fill it in (the server drops those requests).
  const [website, setWebsite] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await api.requestAccess({ email: email.trim(), name: name.trim(), note: note.trim(), website })
      setDone(true)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <form onSubmit={submit} className="bg-card ring-hairline w-full max-w-sm rounded-2xl p-7 shadow-2xl ring-1">
        <div className="mb-6 flex items-center gap-3">
          <Logo className="size-11" />
          <div>
            <h1 className="text-base font-semibold">Sforza</h1>
            <p className="text-muted-foreground text-sm">{done ? 'Request sent' : 'Request access'}</p>
          </div>
        </div>
        {done ? (
          <div className="grid gap-4">
            <p className="flex gap-3 text-sm">
              <MailCheck className="text-primary mt-0.5 size-5 shrink-0" />
              <span>
                Thanks. Your request is in. Once it is accepted, an invitation arrives at <span className="font-medium break-all">{email.trim()}</span> with a
                link to pick your username and password.
              </span>
            </p>
            <Button type="button" variant="outline" onClick={onBack} className="h-10">
              <ArrowLeft /> Back to sign in
            </Button>
          </div>
        ) : (
          <div className="grid gap-4">
            <p className="text-muted-foreground -mt-2 text-sm">Sforza is open by invitation. Leave your email address and you get an invitation by mail once your request is accepted.</p>
            <div className="grid gap-1.5">
              <Label htmlFor="ask-email">Email address</Label>
              <Input id="ask-email" type="email" autoFocus autoComplete="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} className="h-10" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ask-name">
                Your name <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input id="ask-name" autoComplete="name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className="h-10" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ask-note">
                A few words <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Textarea id="ask-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Who you are, or who sent you" />
            </div>
            <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
              <label htmlFor="ask-website">Website</label>
              <input id="ask-website" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
            </div>
            <Button type="submit" disabled={busy || !email.trim()} className="h-10">
              Request access <ArrowRight />
            </Button>
            {error && (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            )}
            <button type="button" onClick={onBack} className="text-muted-foreground hover:text-foreground justify-self-center text-sm">
              I have an account
            </button>
          </div>
        )}
      </form>
    </div>
  )
}
