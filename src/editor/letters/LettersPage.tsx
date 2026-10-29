import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ArrowUpRight, Mail, Plus, Search } from 'lucide-react'
import { toast } from 'sonner'
import type { Application, Lang } from '@shared/types'
import { LANG_LABELS, LANGS } from '@shared/types'
import { ENCLOSURES, LETTER_FRAME } from '@shared/utils'
import { CompanyLogo } from '@/components/CompanyLogo'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import LetterSection, { LetterSheet, SUBJECT, initialLetterLang } from '../applications/LetterSection'
import LetterDesignPanel from './LetterDesignPanel'
import { stageDot } from '../applications/stages'
import { today, useApplications } from '../applications/store'
import { navigate } from '../router'

/** Title of a letter written without a job posting. */
const UNSOLICITED: Record<Lang, string> = { en: 'Unsolicited application', fr: 'Candidature spontanée', de: 'Initiativbewerbung' }

const lastLetterAt = (a: Application) =>
  LANGS.map((l) => a.letters?.[l]?.updatedAt ?? '')
    .sort()
    .at(-1) ?? ''

/** Every motivation letter in one place: pick an application, edit its letters, see the A4 page next to them. */
export default function LettersPage({ appId }: { appId: string | null }) {
  const items = useApplications((s) => s.items)
  const loaded = useApplications((s) => s.loaded)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)

  // Applications with letters first (most recently edited on top), then the rest of the board.
  const sorted = useMemo(
    () =>
      [...items].sort((a, b) => {
        const la = lastLetterAt(a)
        const lb = lastLetterAt(b)
        if (!!la !== !!lb) return la ? -1 : 1
        return (lb || b.updatedAt).localeCompare(la || a.updatedAt)
      }),
    [items],
  )
  const q = query.trim().toLowerCase()
  const shown = q ? sorted.filter((a) => `${a.company} ${a.title}`.toLowerCase().includes(q)) : sorted
  const current = (appId ? items.find((a) => a.id === appId) : undefined) ?? sorted.find((a) => lastLetterAt(a)) ?? sorted[0]

  const [lang, setLang] = useState<Lang>('en')
  // The middle column: the letter's text, or its design (template, fonts, colours).
  const [tab, setTab] = useState<'write' | 'design'>('write')
  useEffect(() => {
    if (current) setLang(initialLetterLang(current))
    // Only when another application is opened, not on every edit of this one.
  }, [current?.id])

  useEffect(() => {
    if (loaded && appId && !items.some((a) => a.id === appId)) navigate({ page: 'letters', appId: null }, { replace: true })
  }, [loaded, appId, items])

  const letter = current?.letters?.[lang]

  // The top bar shows the CV and Download buttons of the open letter.
  useEffect(() => {
    useApplications.setState({ letterView: current ? { appId: current.id, lang } : null })
  }, [current?.id, lang])
  useEffect(() => () => useApplications.setState({ letterView: null }), [])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
      <aside className="border-hairline flex max-h-[38vh] shrink-0 flex-col border-b lg:max-h-none lg:w-72 lg:border-r lg:border-b-0">
        <div className="flex items-center gap-2 p-3">
          <div className="relative flex-1">
            <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Company or role" className="h-9 pl-8" />
          </div>
          <Button size="sm" onClick={() => setCreating(true)} title="Letter without a job posting, e.g. an Initiativbewerbung">
            <Plus /> New
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {loaded && !items.length && (
            <p className="text-muted-foreground px-2 py-6 text-center text-sm">No applications yet. Start a letter with New.</p>
          )}
          {shown.map((a) => {
            const langs = LANGS.filter((l) => a.letters?.[l])
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => navigate({ page: 'letters', appId: a.id }, { replace: true })}
                aria-current={a.id === current?.id ? 'true' : undefined}
                className={cn('hover:bg-muted flex w-full items-center gap-2.5 rounded-lg p-2 text-left', a.id === current?.id && 'bg-muted')}
              >
                <CompanyLogo src={a.logo} name={a.company || a.title} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{a.company || 'No company'}</span>
                  <span className="text-muted-foreground block truncate text-xs">{a.title || '—'}</span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className={cn('size-2 rounded-full', stageDot(a.stage))} />
                  <span className="text-muted-foreground text-[10px] font-semibold tracking-wide">
                    {langs.length ? langs.map((l) => LANG_LABELS[l].short).join(' ') : '—'}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </aside>

      {current ? (
        <div className="flex min-h-0 flex-1 flex-col gap-6 p-4 lg:flex-row lg:overflow-hidden lg:p-6">
          <section className="flex min-w-0 flex-col gap-3 lg:w-[30rem] lg:shrink-0 lg:overflow-y-auto lg:pr-1">
            <header className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-lg font-semibold tracking-tight">{current.company || 'No company'}</h1>
                <p className="text-muted-foreground truncate text-sm">{current.title}</p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => navigate({ page: 'applications', appId: current.id })}>
                Card <ArrowUpRight />
              </Button>
            </header>
            {letter && (
              <div className="bg-muted ring-hairline flex w-fit items-center rounded-lg p-0.5 ring-1">
                {(['write', 'design'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTab(t)}
                    aria-pressed={tab === t}
                    className={cn('text-muted-foreground hover:text-foreground h-7 rounded-md px-3 text-xs font-medium', tab === t && 'bg-background text-foreground shadow-sm')}
                  >
                    {t === 'write' ? 'Letter' : 'Design'}
                  </button>
                ))}
              </div>
            )}
            {letter && tab === 'design' ? (
              <LetterDesignPanel key={current.id} app={current} letter={letter} lang={lang} />
            ) : (
              <LetterSection key={current.id} app={current} lang={lang} onLangChange={setLang} inlinePreview />
            )}
          </section>
          <section className="min-w-0 flex-1 lg:overflow-y-auto">
            {letter ? (
              <div className="mx-auto max-w-[720px]">
                <LetterSheet app={current} letter={letter} lang={lang} />
              </div>
            ) : (
              <div className="text-muted-foreground grid h-full min-h-48 place-items-center rounded-xl border border-dashed text-sm">
                The {LANG_LABELS[lang].name} letter appears here once it exists.
              </div>
            )}
          </section>
        </div>
      ) : (
        <div className="text-muted-foreground grid flex-1 place-items-center p-8 text-sm">
          <div className="flex flex-col items-center gap-3">
            <Mail className="size-6" />
            Start a letter with New, or add an application on the board.
          </div>
        </div>
      )}

      <NewLetterDialog open={creating} onOpenChange={setCreating} />
    </div>
  )
}

/** A letter without a job posting (Initiativbewerbung): creates a draft card that holds it. */
function NewLetterDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [company, setCompany] = useState('')
  const [title, setTitle] = useState('')
  const [lang, setLang] = useState<Lang>('de')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const position = title.trim()
      const frame = LETTER_FRAME[lang]
      const app = await useApplications.getState().create({
        company: company.trim(),
        title: position || UNSOLICITED[lang],
        stage: 'draft',
        lang,
        letters: {
          [lang]: {
            subject: position ? SUBJECT[lang](position) : UNSOLICITED[lang],
            recipient: company.trim(),
            body: `${frame.salutation}\n\n\n\n${frame.closing}`,
            date: today(),
            notes: '',
            enclosures: ENCLOSURES[lang].default,
            updatedAt: new Date().toISOString(),
          },
        },
      })
      onOpenChange(false)
      setCompany('')
      setTitle('')
      navigate({ page: 'letters', appId: app.id })
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>New letter</DialogTitle>
            <DialogDescription>
              For a company without a posting (Initiativbewerbung) or a job you have not added yet. It becomes a Draft card on the board.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="nl-company">Company</Label>
            <Input id="nl-company" value={company} onChange={(e) => setCompany(e.target.value)} autoFocus required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="nl-title">Position (optional)</Label>
            <Input id="nl-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={UNSOLICITED[lang]} />
          </div>
          <div className="grid gap-1.5">
            <Label>Language</Label>
            <div className="bg-muted flex w-fit items-center rounded-lg p-0.5">
              {LANGS.map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLang(l)}
                  aria-pressed={l === lang}
                  className={cn('text-muted-foreground h-8 rounded-md px-3 text-xs font-semibold', l === lang && 'bg-background text-foreground shadow-sm')}
                >
                  {LANG_LABELS[l].name}
                </button>
              ))}
            </div>
            {lang === 'de' && <p className="text-muted-foreground text-xs">German letters use the DIN 5008 layout.</p>}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy || !company.trim()}>
              Create letter
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
