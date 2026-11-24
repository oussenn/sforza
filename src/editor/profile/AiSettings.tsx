import { useEffect, useState } from 'react'
import { Check, ExternalLink, KeyRound, Loader2, RefreshCw, Trash2, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { AI_MODEL_OPTIONS, AI_PROVIDER_LABELS, AI_PROVIDERS, type AiProviderId, type AiSettingsView, type AiStatus } from '@shared/types'
import { ProviderLogo } from '@/components/ProviderLogo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useEditor } from '../store'

const OTHER = '__other'

/** "Claude Opus 5.5" for a known model id, the id itself otherwise. */
function modelLabel(id: string): string {
  for (const p of AI_PROVIDERS) {
    const m = AI_MODEL_OPTIONS[p].find((o) => o.id === id)
    if (m) return m.label
  }
  return id
}

function routeLine(r: Pick<AiStatus, 'provider' | 'model'>, source: AiStatus['source']): string {
  if (r.provider === 'workers-ai') return `${r.model} (the site's free model)`
  const whose = source === 'own' ? 'your' : "the site's"
  return `${modelLabel(r.model)} · ${whose} ${r.provider === 'anthropic' ? 'Anthropic' : 'OpenAI'} key`
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

  const keyed = AI_PROVIDERS.filter((p) => view.keys[p].set)
  return (
    <div className="grid gap-6">
      <p className="text-muted-foreground max-w-3xl text-sm">
        The AI buttons in the editor (tailoring a CV, translating, writing letters, the match score) run on your own API key, billed by the provider to
        you. Add one key or both: with both, the first one runs and the other takes over when a call fails. Every result goes through the same checks as
        an agent's work: facts only from your material, the letter rules, and one page for each CV and letter.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        {AI_PROVIDERS.map((p) => (
          <KeyCard
            key={p}
            provider={p}
            state={view.keys[p]}
            order={keyed.length > 1 ? (view.active.provider === p ? 'first' : 'fallback') : null}
            onSave={(key) => apply(api.saveAiSettings({ keys: { [p]: key } }), `${AI_PROVIDER_LABELS[p].name} key saved`)}
            onRemove={() => apply(api.saveAiSettings({ keys: { [p]: null } }), `${AI_PROVIDER_LABELS[p].name} key removed`)}
            onCheck={() => apply(api.checkAiKey(p))}
          />
        ))}
      </div>

      <ModelChoice view={view} keyed={keyed} onChange={(change) => apply(api.saveAiSettings(change))} />

      <div className="bg-muted/50 rounded-xl px-4 py-3 text-sm">
        {view.active.provider === 'none' ? (
          <span className="flex items-center gap-2">
            <TriangleAlert className="size-4 text-amber-600" /> No AI yet: add a key above to use the AI buttons.
          </span>
        ) : (
          <div className="grid gap-0.5">
            <div>
              <span className="text-muted-foreground">Now in use: </span>
              <span className="font-medium">{routeLine(view.active, view.active.source)}</span>
            </div>
            {view.active.fallback && (
              <div>
                <span className="text-muted-foreground">If it fails: </span>
                {routeLine(view.active.fallback, view.active.source)}
              </div>
            )}
            {view.active.source === 'site' && <div className="text-muted-foreground text-xs">Without your own key the buttons use the site's shared AI, which has a small daily budget.</div>}
          </div>
        )}
      </div>

      <p className="text-muted-foreground text-xs">
        Keys are sent once over HTTPS, stored encrypted and never shown again, only their last four characters. They are used for this account's AI
        calls and nothing else; agents connected over MCP never see them. Removing a key deletes it.
      </p>
    </div>
  )
}

function KeyCard(props: {
  provider: AiProviderId
  state: AiSettingsView['keys'][AiProviderId]
  order: 'first' | 'fallback' | null
  onSave: (key: string) => Promise<unknown>
  onRemove: () => Promise<unknown>
  onCheck: () => Promise<unknown>
}) {
  const { provider, state, order } = props
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
    <section className="ring-hairline bg-background rounded-2xl p-4 ring-1">
      <div className="mb-3 flex items-center gap-3">
        <div className="bg-card ring-hairline grid size-10 shrink-0 place-items-center rounded-xl ring-1">
          <ProviderLogo provider={provider} className="size-6" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-base leading-tight font-semibold">{labels.product}</h3>
          <div className="text-muted-foreground text-xs">{labels.name} API key</div>
        </div>
        {order && (
          <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', order === 'first' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
            {order === 'first' ? 'Used first' : 'Takes over on failure'}
          </span>
        )}
      </div>

      {state.set && !editing ? (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <KeyRound className="text-muted-foreground size-4" />
            <span className="font-mono">{state.hint}</span>
            {state.ok === true && (
              <span className="flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
                <Check className="size-3.5" /> works
              </span>
            )}
            {state.ok === false && <span className="text-destructive text-xs">{state.error}</span>}
            {state.ok === null && state.error && <span className="text-muted-foreground text-xs">{state.error}</span>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void run('check', props.onCheck)}>
              {busy === 'check' ? <Loader2 className="animate-spin" /> : <RefreshCw />} Check again
            </Button>
            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => setEditing(true)}>
              Replace
            </Button>
            <Button size="sm" variant="ghost" className="text-muted-foreground" disabled={!!busy} onClick={() => void run('remove', props.onRemove)}>
              {busy === 'remove' ? <Loader2 className="animate-spin" /> : <Trash2 />} Remove
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (value.trim()) void run('save', () => props.onSave(value.trim()))
          }}
        >
          <div className="flex gap-2">
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={`${labels.keyPrefix}…`}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-label={`${labels.name} API key`}
              className="font-mono"
            />
            <Button type="submit" disabled={!value.trim() || !!busy}>
              {busy === 'save' ? <Loader2 className="animate-spin" /> : null} Save
            </Button>
          </div>
          <div className="flex items-center justify-between gap-2 text-xs">
            <a href={labels.keysUrl} target="_blank" rel="noreferrer noopener" className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
              Get a key <ExternalLink className="size-3" />
            </a>
            {state.set && (
              <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setEditing(false)}>
                Cancel
              </button>
            )}
          </div>
          <p className="text-muted-foreground text-xs">The key is checked with the provider before it is saved.</p>
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
    <section className="grid gap-3">
      <h3 className="text-sm font-semibold">Model</h3>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Model choice">
        {(['auto', 'manual'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={view.mode === m}
            onClick={() => void save(m === 'manual' && !view.model ? { mode: m, provider: keyed[0] ?? 'anthropic', model: AI_MODEL_OPTIONS[keyed[0] ?? 'anthropic'][0].id } : { mode: m })}
            className={cn(
              'rounded-xl px-3 py-2 text-left text-sm ring-1 transition',
              view.mode === m ? 'bg-primary text-primary-foreground ring-primary' : 'ring-hairline hover:bg-muted',
            )}
          >
            <div className="font-medium">{m === 'auto' ? 'Automatic' : 'Choose your model'}</div>
            <div className={cn('text-xs', view.mode === m ? 'opacity-80' : 'text-muted-foreground')}>
              {m === 'auto' ? 'The best model for CVs and letters on each key' : 'One model of your choice, the other key as backup'}
            </div>
          </button>
        ))}
      </div>
      {view.mode === 'auto' ? (
        <p className="text-muted-foreground text-xs">
          With an Anthropic key: {AI_MODEL_OPTIONS.anthropic[0].label}. With an OpenAI key: {AI_MODEL_OPTIONS.openai[0].label}. The app moves to newer models
          as they come out.
        </p>
      ) : (
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
                    {AI_PROVIDER_LABELS[p].product} ({AI_PROVIDER_LABELS[p].name}){view.keys[p].set ? '' : ': add a key first'}
                  </SelectLabel>
                  {AI_MODEL_OPTIONS[p].map((o) => (
                    <SelectItem key={o.id} value={`${p}:${o.id}`} disabled={!view.keys[p].set}>
                      {o.label} <span className="text-muted-foreground ml-1 text-xs">{o.note}</span>
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
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AI_PROVIDERS.map((p) => (
                    <SelectItem key={p} value={p} disabled={!view.keys[p].set}>
                      {AI_PROVIDER_LABELS[p].name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="model id, e.g. claude-sonnet-5-5" className="font-mono" />
              <Button type="submit" variant="outline" disabled={!custom.trim()}>
                Use
              </Button>
            </form>
          )}
          {!keyed.length && <p className="text-muted-foreground text-xs">Add a key above first: the choice only applies to your own keys.</p>}
        </div>
      )}
    </section>
  )
}
