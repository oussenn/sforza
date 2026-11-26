import { useEffect, useState, type FormEvent } from 'react'
import { Check, Copy, Inbox, KeyRound, Link2, Loader2, Lock, LockOpen, Mail, Send, Trash2, UserPlus, Users, X } from 'lucide-react'
import { toast } from 'sonner'
import type { AccessRequest, AccountInfo, InviteInfo } from '@shared/types'
import { PASSWORD_MIN, passwordProblem } from '@shared/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiError, api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useSession } from './session'

const day = (seconds: number) => new Date(seconds * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

/** The signed-in account: a new password, and for the admin, the people on this site and their invitations. */
export function AccountDialog({ open, onOpenChange, user }: { open: boolean; onOpenChange: (open: boolean) => void; user: string }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Account</DialogTitle>
          <DialogDescription>Signed in as {user}.</DialogDescription>
        </DialogHeader>
        {open && <PasswordForm user={user} />}
        {open && <People user={user} />}
      </DialogContent>
    </Dialog>
  )
}

function PasswordField({ id, label, value, onChange, autoComplete }: { id: string; label: string; value: string; onChange: (v: string) => void; autoComplete: string }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="password" autoComplete={autoComplete} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}

function PasswordForm({ user }: { user: string }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const problem = passwordProblem(next, user) ?? (next !== confirm ? 'The two new passwords differ.' : null)
    if (problem) return setError(problem)
    setBusy(true)
    setError('')
    try {
      await api.changePassword(current, next)
      setCurrent('')
      setNext('')
      setConfirm('')
      toast.success('Password changed. Your other devices are signed out.')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <KeyRound className="size-4" /> Password
      </h3>
      {/* Lets a password manager file the new password under this account. */}
      <input type="text" name="username" autoComplete="username" value={user} readOnly tabIndex={-1} aria-hidden className="sr-only" />
      <PasswordField id="pw-current" label="Current password" value={current} onChange={setCurrent} autoComplete="current-password" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <PasswordField id="pw-new" label="New password" value={next} onChange={setNext} autoComplete="new-password" />
        <PasswordField id="pw-confirm" label="Repeat it" value={confirm} onChange={setConfirm} autoComplete="new-password" />
      </div>
      <p className="text-muted-foreground text-xs">
        At least {PASSWORD_MIN} characters. Changing it signs out your other devices and ends download links shared before.
      </p>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <Button type="submit" size="sm" className="justify-self-start" disabled={busy || !current || !next || !confirm}>
        {busy && <Loader2 className="animate-spin" />} Change password
      </Button>
    </form>
  )
}

/** Only the admin sees this part: everyone else gets a 403 for the list and nothing is shown. */
function People({ user }: { user: string }) {
  const [data, setData] = useState<{ accounts: AccountInfo[]; invites: InviteInfo[]; requests: AccessRequest[]; mail: boolean } | null>(null)
  const [link, setLink] = useState<{ url: string; expiresAt: number; email?: string; mailto?: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const load = () =>
    api
      .accounts()
      .then((d) => {
        setData(d)
        useSession.setState({ pendingRequests: d.requests.filter((r) => r.status === 'pending').length })
      })
      .catch((err: Error) => {
        if (!(err instanceof ApiError && err.status === 403)) toast.error(err.message)
      })

  useEffect(() => {
    void load()
  }, [])

  if (!data) return null

  const run = async (key: string, action: () => Promise<unknown>, done?: string) => {
    setBusy(key)
    try {
      await action()
      await load()
      if (done) toast.success(done)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const invite = () =>
    run('invite', async () => {
      setLink(await api.createInvite())
      setCopied(false)
    })

  // Answers a request: the server mails the invitation when it can; otherwise the admin's mail app opens with it written.
  const inviteByMail = (r: AccessRequest) =>
    run(r.id, async () => {
      const res = await api.inviteRequest(r.id)
      if (res.sent) {
        setLink(null)
        toast.success(`Invitation sent to ${res.email}`)
        return
      }
      const mailto = `mailto:${encodeURIComponent(res.email)}?subject=${encodeURIComponent(res.mail.subject)}&body=${encodeURIComponent(res.mail.text)}`
      setLink({ url: res.url, expiresAt: res.expiresAt, email: res.email, mailto })
      setCopied(false)
      window.location.href = mailto
    })

  const copy = async () => {
    if (!link) return
    await navigator.clipboard.writeText(link.url)
    setCopied(true)
  }

  const linkBox = (l: NonNullable<typeof link>) => (
    <div className="bg-muted/60 grid gap-2 rounded-xl p-3">
      <div className="flex gap-2">
        <Input readOnly value={l.url} onFocus={(e) => e.target.select()} className="bg-background font-mono text-xs" aria-label="Invitation link" />
        <Button size="sm" variant="outline" onClick={() => void copy()}>
          {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        {l.email ? (
          <>
            Your mail app opened with the invitation to {l.email}. If it did not,{' '}
            <a href={l.mailto} className="text-foreground underline underline-offset-2">
              open it again
            </a>{' '}
            or copy the link. Works once, until {day(l.expiresAt)}.
          </>
        ) : (
          <>Works once, until {day(l.expiresAt)}. Send it privately: whoever opens it first creates the account. It is shown only now.</>
        )}
      </p>
    </div>
  )

  const waiting = data.requests.filter((r) => r.status !== 'joined')
  const joined = data.requests.filter((r) => r.status === 'joined')

  return (
    <div className="grid gap-3 border-t pt-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Inbox className="size-4" /> Requests for access
        {waiting.some((r) => r.status === 'pending') && (
          <Badge className="tabular-nums">{waiting.filter((r) => r.status === 'pending').length} waiting</Badge>
        )}
      </h3>
      {waiting.length === 0 ? (
        <p className="text-muted-foreground text-xs">Nobody is waiting. People ask for access with “Request access” on the sign-in page.</p>
      ) : (
        <ul className="grid gap-2">
          {waiting.map((r) => (
            <li key={r.id} className="bg-muted/50 grid gap-1 rounded-xl p-3 text-sm">
              <div className="flex min-w-0 items-center gap-2">
                <Mail className="text-muted-foreground size-3.5 shrink-0" />
                <span className="min-w-0 truncate font-medium">{r.email}</span>
                {r.name && <span className="text-muted-foreground truncate text-xs">{r.name}</span>}
                <span className="text-muted-foreground ml-auto shrink-0 text-xs">{day(Date.parse(r.createdAt) / 1000)}</span>
              </div>
              {r.note && <p className="text-muted-foreground text-xs break-words">“{r.note}”</p>}
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                {r.status === 'invited' && <Badge variant="outline">invited {day(Date.parse(r.updatedAt) / 1000)}</Badge>}
                <Button size="sm" className="h-7 text-xs" disabled={busy !== null} onClick={() => void inviteByMail(r)}>
                  {busy === r.id ? <Loader2 className="animate-spin" /> : <Send />} {r.status === 'invited' ? 'Send again' : 'Invite by mail'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  disabled={busy !== null}
                  onClick={() => void run(`x${r.id}`, () => api.declineRequest(r.id), `Request of ${r.email} removed`)}
                >
                  <X /> Decline
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {link?.email && linkBox(link)}
      {waiting.length > 0 && (
        <p className="text-muted-foreground text-xs">
          {data.mail
            ? 'Sforza mails the invitation itself: a one-time link to pick a username and password, valid for 7 days.'
            : 'Your mail app opens with the invitation written and addressed: a one-time link, valid for 7 days. You press send.'}
        </p>
      )}
      {joined.length > 0 && (
        <p className="text-muted-foreground text-xs">Joined lately: {joined.map((r) => `${r.username} (${r.email})`).join(', ')}</p>
      )}

      <h3 className="mt-2 flex items-center gap-2 text-sm font-semibold">
        <Users className="size-4" /> People
      </h3>
      <ul className="grid gap-1">
        {data.accounts.map((a) => (
          <li key={a.username} className="flex min-h-8 items-center gap-2 text-sm">
            <span className={cn('font-medium', a.disabled && 'text-muted-foreground line-through')}>{a.username}</span>
            {a.admin && <Badge variant="secondary">admin</Badge>}
            {a.disabled && <Badge variant="outline">locked</Badge>}
            {a.username === user && <span className="text-muted-foreground text-xs">you</span>}
            <span className="text-muted-foreground ml-auto text-xs">{a.source === 'secret' ? 'AUTH_USERS' : 'made in the app'}</span>
            {a.username !== user && !a.admin && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                disabled={busy !== null}
                onClick={() =>
                  void run(
                    a.username,
                    () => api.setLocked(a.username, !a.disabled),
                    a.disabled ? `${a.username} can sign in again` : `${a.username} is signed out and locked`,
                  )
                }
              >
                {a.disabled ? <LockOpen /> : <Lock />} {a.disabled ? 'Unlock' : 'Lock'}
              </Button>
            )}
          </li>
        ))}
      </ul>
      <Button size="sm" variant="outline" className="justify-self-start" onClick={() => void invite()} disabled={busy !== null}>
        {busy === 'invite' ? <Loader2 className="animate-spin" /> : <UserPlus />} Invite someone
      </Button>
      {link && !link.email && linkBox(link)}
      {data.invites.length > 0 && (
        <ul className="grid gap-1">
          {data.invites.map((i) => (
            <li key={i.id} className="text-muted-foreground flex items-center gap-2 text-xs">
              <Link2 className="size-3.5 shrink-0" /> <span className="min-w-0 truncate">Invitation{i.email ? ` for ${i.email}` : ''} of {day(Date.parse(i.createdAt) / 1000)}, open until {day(i.expiresAt)}</span>
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto h-7 text-xs"
                disabled={busy !== null}
                onClick={() => void run(i.id, () => api.revokeInvite(i.id), 'Invitation revoked')}
              >
                <Trash2 /> Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
