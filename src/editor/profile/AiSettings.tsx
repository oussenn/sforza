import { Fragment, useEffect, useState } from 'react'
import { ArrowRight, Check, ExternalLink, KeyRound, Loader2, Pencil, RefreshCw, Trash2, TriangleAlert, X } from 'lucide-react'
import { toast } from 'sonner'
import { AI_MODEL_OPTIONS, AI_PROVIDER_LABELS, AI_PROVIDERS, type AiProviderId, type AiSettingsView } from '@shared/types'
import { InfoTip } from '@/components/InfoTip'
import { ProviderLogo } from '@/components/ProviderLogo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useEditor } from '../store'

const OTHER = '__other'
const ORDINAL = ['1st', '2nd', '3rd']

/** "Claude Opus 5.5" for a known model id, the id itself otherwise. */
function modelLabel(id: string): string {
  for (const p of AI_PROVIDERS) {
    const m = AI_MODEL_OPTIONS[p].find((o) => o.id === id)
    if (m) return m.label
  }
  return id
}

/** The providers with a key in the order the AI buttons try them (as worker/ai.ts aiRoutes), with their model. */
function routeOrder(view: AiSettingsView): { provider: AiProviderId; model: string }[] {
  const keyed = AI_PROVIDERS.filter((p) => view.keys[p].set)
  const first = view.mode === 'manual' && keyed.includes(view.provider) ? view.provider : null
  return [...(first ? [first] : []), ...keyed.filter((p) => p !== first)].map((p) => ({
    provider: p,
    model: p === first && view.model ? view.model : AI_MODEL_OPTIONS[p][0].id,
  }))
}

/** A small icon button with its name in a tooltip. */
function IconAction({ label, onClick, disabled, busy, children, danger }: { label: string; onClick: () => void; disabled?: boolean; busy?: boolean; children: React.ReactNode; danger?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size="icon" variant="ghost" aria-label={label} disabled={disabled} onClick={onClick} className={cn('size-8', danger && 'hover:text-destructive')}>
          {busy ? <Loader2 className="animate-spin" /> : children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * The account's own AI: an API key for each provider and the model the AI buttons use. Keys go to the server once,
 * are stored encrypted and never come back: the page only shows whether a key is set and its last four characters.
 */
export default function AiSettings() {
  const [view, setView] = useState<AiSettingsView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refreshAi = useEditor((s) => s.refreshAi)

  useEffect(() => {
    api
      .aiSettings()
      .then(setView)
      .catch((err: Error) => setError(err.message))
  }, [])

  const apply = async (call: Promise<AiSettingsView>, done?: string) => {
    const next = await call
    setView(next)
    void refreshAi()
    if (done) toast.success(done)
    return next
  }

  if (error) return <p className="text-muted-foreground text-sm">{/demo/i.test(error) ? 'The demo has no AI: sign in to your own account to add an API key.' : error}</p>
  if (!view) return <p className="text-muted-foreground text-sm">Loading…</p>

  const order = routeOrder(view)
  const keyed = order.map((r) => r.provider)
  return (
    <div className="grid gap-6">
      <div className="flex items-center gap-1.5 text-sm font-semibold">
        Your API keys
        <InfoTip>
          The AI buttons (tailoring, translating, letters, match score) run on your own key, billed to you by the provider. With more than one key, the
          next takes over when a call fails. Keys are stored encrypted, never shown again, and never reach connected agents.
        </InfoTip>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {AI_PROVIDERS.map((p) => (
          <KeyCard
            key={p}
            provider={p}
            state={view.keys[p]}
            rank={keyed.length > 1 ? keyed.indexOf(p) : -1}
            onSave={(key) => apply(api.saveAiSettings({ keys: { [p]: key } }), `${AI_PROVIDER_LABELS[p].product} key saved`)}
            onRemove={() => apply(api.saveAiSettings({ keys: { [p]: null } }), `${AI_PROVIDER_LABELS[p].product} key removed`)}
            onCheck={() => apply(api.checkAiKey(p))}
          />
        ))}
      </div>

      <ModelChoice view={view} keyed={keyed} onChange={(change) => apply(api.saveAiSettings(change))} />

      <div className="bg-muted/50 flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl px-3 py-2 text-sm">
        {order.length ? (
          order.map((r, i) => (
            <Fragment key={r.provider}>
              {i > 0 && <ArrowRight className="text-muted-foreground size-3.5" aria-label="if it fails" />}
              <span className={cn('inline-flex items-center gap-1.5', i > 0 && 'text-muted-foreground')}>
                <ProviderLogo provider={r.provider} className="size-3.5" />
                <span className={cn(i === 0 && 'font-medium')}>{modelLabel(r.model)}</span>
              </span>
            </Fragment>
          ))
        ) : view.active.provider === 'none' ? (
          <span className="flex items-center gap-2">
            <TriangleAlert className="size-4 text-amber-600" /> No AI yet: add a key above.
          </span>
        ) : (
          <span className="text-muted-foreground inline-flex items-center gap-1.5">
            The site's shared AI: <span className="text-foreground font-mono text-xs">{view.active.model}</span>
            <InfoTip>Without a key of your own the buttons use the site's AI, which has a small daily budget.</InfoTip>
          </span>
        )}
        {order.length > 0 && (
          <InfoTip className="ml-auto">The first model answers; when its call fails (key, quota, outage, timeout), the next one takes over.</InfoTip>
        )}
      </div>
    </div>
  )
}

function KeyCard(props: {
  provider: AiProviderId
  state: AiSettingsView['keys'][AiProviderId]
  /** position in the fallback order, -1 when it is the only key or has none */
  rank: number
  onSave: (key: string) => Promise<unknown>
  onRemove: () => Promise<unknown>
  onCheck: () => Promise<unknown>
}) {
  const { provider, state, rank } = props
  const labels = AI_PROVIDER_LABELS[provider]
  const [editing, setEditing] = useState(!state.set)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState<'save' | 'remove' | 'check' | null>(null)
  useEffect(() => setEditing(!state.set), [state.set])

  const run = async (what: 'save' | 'remove' | 'check', fn: () => Promise<unknown>) => {
    setBusy(what)
    try {
      await fn()
      if (what === 'save') setValue('')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className={cn('ring-hairline bg-background flex min-h-36 flex-col gap-3 rounded-2xl p-4 ring-1', state.set && 'ring-foreground/15')}>
      <div className="flex items-center gap-3">
        <div className="bg-card ring-hairline grid size-10 shrink-0 place-items-center rounded-xl ring-1">
          <ProviderLogo provider={provider} className="size-6" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-1.5 text-base leading-tight font-semibold">
            {labels.product}
            <InfoTip>
              {labels.name} API key, billed by {labels.name} to you. It is checked with {labels.name} before it is saved.
            </InfoTip>
          </h3>
          <div className="text-muted-foreground text-xs">{labels.name}</div>
        </div>
        {rank >= 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', rank === 0 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
                {ORDINAL[rank]}
              </span>
            </TooltipTrigger>
            <TooltipContent>{rank === 0 ? 'Runs first' : `Takes over if the ${ORDINAL[rank - 1]} fails`}</TooltipContent>
          </Tooltip>
        )}
      </div>

      {state.set && !editing ? (
        <div className="mt-auto grid gap-1">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <KeyRound className="text-muted-foreground size-4 shrink-0" />
            <span className="truncate font-mono">{state.hint}</span>
            {state.ok === true && <Check className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="works" />}
            {state.ok === false && <TriangleAlert className="text-destructive size-4 shrink-0" aria-label="problem" />}
            {state.error && <InfoTip>{state.error}</InfoTip>}
          </div>
          <div className="-ml-2 flex items-center">
            <IconAction label="Check again" disabled={!!busy} busy={busy === 'check'} onClick={() => void run('check', props.onCheck)}>
              <RefreshCw />
            </IconAction>
            <IconAction label="Replace" disabled={!!busy} onClick={() => setEditing(true)}>
              <Pencil />
            </IconAction>
            <IconAction label="Remove" danger disabled={!!busy} busy={busy === 'remove'} onClick={() => void run('remove', props.onRemove)}>
              <Trash2 />
            </IconAction>
          </div>
        </div>
      ) : (
        <form
          className="mt-auto grid gap-1"
          onSubmit={(e) => {
            e.preventDefault()
            if (value.trim()) void run('save', () => props.onSave(value.trim()))
          }}
        >
          <div className="flex gap-1.5">
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={labels.keyPrefix ? `${labels.keyPrefix}…` : 'API key'}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-label={`${labels.name} API key`}
              className="h-8 min-w-0 font-mono text-xs"
            />
            <Button type="submit" size="sm" disabled={!value.trim() || !!busy}>
              {busy === 'save' ? <Loader2 className="animate-spin" /> : 'Save'}
            </Button>
          </div>
          <div className="-ml-2 flex items-center">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button asChild size="icon" variant="ghost" className="size-8">
                  <a href={labels.keysUrl} target="_blank" rel="noreferrer noopener" aria-label={`Get a ${labels.name} key`}>
                    <ExternalLink />
                  </a>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Get a key from {labels.name}</TooltipContent>
            </Tooltip>
            {state.set && (
              <IconAction label="Cancel" onClick={() => setEditing(false)}>
                <X />
              </IconAction>
            )}
          </div>
        </form>
      )}
    </section>
  )
}

function ModelChoice({ view, keyed, onChange }: { view: AiSettingsView; keyed: AiProviderId[]; onChange: (c: { mode?: 'auto' | 'manual'; provider?: AiProviderId; model?: string }) => Promise<unknown> }) {
  const known = AI_MODEL_OPTIONS[view.provider].some((o) => o.id === view.model)
  const [other, setOther] = useState(view.mode === 'manual' && !!view.model && !known)
  const [custom, setCustom] = useState(known ? '' : view.model)
  const save = (c: Parameters<typeof onChange>[0]) => onChange(c).catch((err: Error) => toast.error(err.message))
  const current = view.mode === 'manual' ? (other ? OTHER : `${view.provider}:${view.model || AI_MODEL_OPTIONS[view.provider][0].id}`) : ''

  return (
    <section className="grid gap-2.5">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          Model
          <InfoTip>
            Automatic: {AI_PROVIDERS.map((p) => `${AI_MODEL_OPTIONS[p][0].label} on ${AI_PROVIDER_LABELS[p].product}`).join(', ')}, tried in that order. Choose:
            one model runs first, your other keys stay as backup.
          </InfoTip>
        </h3>
        <div className="bg-muted inline-flex rounded-lg p-0.5" role="radiogroup" aria-label="Model choice">
          {(['auto', 'manual'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={view.mode === m}
              onClick={() => void save(m === 'manual' && !view.model ? { mode: m, provider: keyed[0] ?? 'anthropic', model: AI_MODEL_OPTIONS[keyed[0] ?? 'anthropic'][0].id } : { mode: m })}
              className={cn('rounded-md px-3 py-1 text-sm font-medium transition', view.mode === m ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
            >
              {m === 'auto' ? 'Automatic' : 'Choose'}
            </button>
          ))}
        </div>
      </div>
      {view.mode === 'manual' && (
        <div className="grid max-w-xl gap-2">
          <Select
            value={current}
            onValueChange={(v) => {
              if (v === OTHER) {
                setOther(true)
                return
              }
              setOther(false)
              const [provider, model] = v.split(':') as [AiProviderId, string]
              void save({ mode: 'manual', provider, model })
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose a model" />
            </SelectTrigger>
            <SelectContent>
              {AI_PROVIDERS.map((p) => (
                <SelectGroup key={p}>
                  <SelectLabel>
                    {AI_PROVIDER_LABELS[p].product}
                    {view.keys[p].set ? '' : ': add a key first'}
                  </SelectLabel>
                  {AI_MODEL_OPTIONS[p].map((o) => (
                    <SelectItem key={o.id} value={`${p}:${o.id}`} disabled={!view.keys[p].set}>
                      {o.label} <span className="text-muted-foreground ml-1 text-xs">{o.note.replace(/^Automatic choice: /, '')}</span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
              <SelectItem value={OTHER}>Another model id…</SelectItem>
            </SelectContent>
          </Select>
          {other && (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (custom.trim()) void save({ mode: 'manual', provider: view.provider, model: custom.trim() })
              }}
            >
              <Select value={view.provider} onValueChange={(v) => void save({ mode: 'manual', provider: v as AiProviderId, model: custom.trim() || view.model })}>
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AI_PROVIDERS.map((p) => (
                    <SelectItem key={p} value={p} disabled={!view.keys[p].set}>
                      {AI_PROVIDER_LABELS[p].product}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="model id" className="font-mono" />
              <Button type="submit" variant="outline" disabled={!custom.trim()}>
                Use
              </Button>
            </form>
          )}
          {!keyed.length && <p className="text-muted-foreground text-xs">Add a key first.</p>}
        </div>
      )}
    </section>
  )
}
