import { useState, type FormEvent } from 'react'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'

export default function Login({ onSuccess }: { onSuccess: (user: string) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const { user } = await api.login(username, password)
      onSuccess(user)
    } catch (err) {
      setError((err as Error).message)
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-[var(--preview-canvas)] px-4">
      <form onSubmit={submit} className="bg-card ring-hairline w-full max-w-sm rounded-2xl p-7 shadow-sm ring-1">
        <div className="mb-6 flex items-center gap-3">
          <img src="/logo.png" alt="" className="size-11" />
          <div>
            <h1 className="text-base font-semibold">Sforza</h1>
            <p className="text-muted-foreground text-sm">Sign in to your account</p>
          </div>
        </div>
        <div className="grid gap-4">
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
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={!!error}
              className="h-10"
            />
          </div>
          <Button type="submit" disabled={busy || !username || !password} className="h-10">
            Sign in <ArrowRight />
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-destructive mt-3 text-sm">
            {error}
          </p>
        )}
      </form>
    </div>
  )
}
