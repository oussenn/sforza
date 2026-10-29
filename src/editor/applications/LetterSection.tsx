import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Copy, Download, Eye, Loader2, Mail, PenLine, RefreshCw, Trash2, TriangleAlert, WandSparkles } from 'lucide-react'
import { toast } from 'sonner'
import type { Application, CoverLetter, Lang, Resume } from '@shared/types'
import { LANG_LABELS, LANGS, LETTER_LAYOUT_LABELS, LETTER_LAYOUTS } from '@shared/types'
import { ENCLOSURES, LETTER_FRAME, letterLayoutOf, letterStyleOf } from '@shared/utils'
import { InfoTip } from '@/components/InfoTip'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { downloadLetterPdf } from '@/resume/download'
import { LetterDocument } from '@/resume/LetterDocument'
import { SHEET_WIDTH } from '@/resume/ResumeDocument'
import { useEditor } from '../store'
import { today, useApplications } from './store'

export const SUBJECT: Record<Lang, (title: string) => string> = {
  en: (t) => `Application for the position of ${t}`,
  fr: (t) => `Candidature au poste de ${t}`,
  de: (t) => `Bewerbung als ${t}`,
}

/** The language a letter view opens in: the one asked for from the board, else the first written one. */
export function initialLetterLang(app: Application): Lang {
  const focus = useApplications.getState().letterFocus
  return focus?.appId === app.id ? focus.lang : (LANGS.find((l) => app.letters?.[l]) ?? app.lang ?? 'en')
}

/**
 * Motivation letters of an application: one per language, written by the AI or by hand. The language is
 * controlled when `lang` is given (the Letters page shows the preview next to it), else kept here.
 */
export default function LetterSection({
  app,
  lang: controlledLang,
  onLangChange,
  inlinePreview = false,
}: {
  app: Application
  lang?: Lang
  onLangChange?: (lang: Lang) => void
  /** the page shows the preview itself: no Preview button */
  inlinePreview?: boolean
}) {
  const aiOn = useEditor((s) => s.ai?.provider !== 'none')
  // Opened from a letter chip on the board: that language, scrolled into view.
  const [focused] = useState(() => useApplications.getState().letterFocus?.appId === app.id)
  const [ownLang, setOwnLang] = useState<Lang>(() => initialLetterLang(app))
  const lang = controlledLang ?? ownLang
  const setLang = (l: Lang) => (onLangChange ? onLangChange(l) : setOwnLang(l))
  const [busy, setBusy] = useState<'ai' | 'pdf' | null>(null)
  const [progress, setProgress] = useState('')
  const [preview, setPreview] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const letter = app.letters?.[lang]
  const { update } = useApplications.getState()

  useEffect(() => {
    if (!focused) return
    useApplications.setState({ letterFocus: null })
    // After the panel has slid in.
    const t = setTimeout(() => root.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 350)
    return () => clearTimeout(t)
  }, [focused])

  const copyText = async () => {
    if (!letter) return
    try {
      await navigator.clipboard.writeText(`${letter.subject}\n\n${letter.body}`)
      toast.success('Letter copied', { description: 'Paste it into an AI detector or an application form.' })
    } catch {
      toast.error('Could not copy the letter.')
    }
  }

  const edit = (patch: Partial<CoverLetter>) =>
    update(app.id, (d) => {
      const current = d.letters?.[lang]
      if (current) d.letters![lang] = { ...current, ...patch, updatedAt: new Date().toISOString() }
    })

  const startByHand = () =>
    update(app.id, (d) => {
      const frame = LETTER_FRAME[lang]
      d.letters = {
        ...d.letters,
        [lang]: {
          subject: SUBJECT[lang](app.title || '…'),
          recipient: [app.company, app.location].filter(Boolean).join('\n'),
          body: `${frame.salutation}\n\n\n\n${frame.closing}`,
          date: today(),
          notes: '',
          enclosures: ENCLOSURES[lang].default,
          updatedAt: new Date().toISOString(),
        },
      }
    })

  const writeWithAi = async () => {
    setBusy('ai')
    setProgress('Writing the letter…')
    try {
      await useApplications.getState().flush()
      useApplications.getState().replace(await api.writeLetter({ applicationId: app.id, lang }, setProgress))
      toast.success(`${LANG_LABELS[lang].name} letter written`, { description: 'Read it through and adjust anything before sending.' })
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(null)
      void useEditor.getState().refreshAi()
    }
  }

  const pdf = async () => {
    setBusy('pdf')
    try {
      await Promise.all([useApplications.getState().flush(), useEditor.getState().flush()])
      await downloadLetterPdf(app.id, lang)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const warning = letter?.notes.includes('Check before sending')

  return (
    <div ref={root} className="bg-muted/50 grid scroll-mt-4 gap-3 rounded-xl p-3">
      <div className="flex items-center gap-2">
        <Mail className="text-muted-foreground size-4" />
        <span className="flex-1 text-sm font-medium">Motivation letter</span>
        <div className="bg-background ring-hairline flex items-center rounded-lg p-0.5 ring-1">
          {LANGS.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLang(l)}
              title={app.letters?.[l] ? `${LANG_LABELS[l].name} letter` : `No ${LANG_LABELS[l].name} letter yet`}
              className={cn(
                'text-muted-foreground hover:text-foreground relative h-7 rounded-md px-2.5 text-xs font-semibold',
                l === lang && 'bg-muted text-foreground',
              )}
            >
              {LANG_LABELS[l].short}
              {app.letters?.[l] && <span className="bg-foreground absolute top-1 right-1 size-1 rounded-full" />}
            </button>
          ))}
        </div>
      </div>

      {!letter ? (
        <div className="grid gap-2">
          <p className="text-muted-foreground text-xs">
            No {LANG_LABELS[lang].name} letter yet. The AI writes it from the CV linked above and the job description, using only facts
            from your material (about $0.002).
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void writeWithAi()} disabled={busy !== null || !aiOn || !app.title.trim()}>
              {busy === 'ai' ? <Loader2 className="animate-spin" /> : <WandSparkles />}
              {busy === 'ai' ? progress : 'Write with AI'}
            </Button>
            <Button size="sm" variant="outline" onClick={startByHand} disabled={busy !== null}>
              <PenLine /> Write it myself
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="grid gap-1.5">
            <Label className="text-muted-foreground text-xs">Subject</Label>
            <Input value={letter.subject} onChange={(e) => edit({ subject: e.target.value })} className="bg-background" />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-muted-foreground text-xs">Layout</Label>
            <div className="bg-background ring-hairline flex w-fit items-center rounded-lg p-0.5 ring-1">
              {LETTER_LAYOUTS.map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => edit({ layout: l })}
                  aria-pressed={letterLayoutOf(letter, lang) === l}
                  className={cn(
                    'text-muted-foreground hover:text-foreground h-7 rounded-md px-3 text-xs font-medium',
                    letterLayoutOf(letter, lang) === l && 'bg-muted text-foreground',
                  )}
                >
                  {LETTER_LAYOUT_LABELS[l]}
                </button>
              ))}
            </div>
            {letterLayoutOf(letter, lang) === 'din5008' && (
              <p className="text-muted-foreground text-[11px]">
                German standard: the recipient sits where a window envelope shows it, so give the full postal address (company, contact, street,
                postcode and city) when you know it.
              </p>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label className="text-muted-foreground text-xs">Recipient</Label>
            <Textarea
              value={letter.recipient}
              onChange={(e) => edit({ recipient: e.target.value })}
              rows={4}
              className="bg-background min-h-0 resize-none"
              placeholder={'Company\nContact person or HR team\nStreet and number\nPostcode City'}
            />
          </div>
          <div className="grid gap-1.5">
            <div className="flex items-center gap-1">
              <Label className="text-muted-foreground text-xs">Letter</Label>
              <InfoTip label="About the letter text">Leave a blank line between paragraphs. Your name, contacts, place and date are added.</InfoTip>
            </div>
            <Textarea value={letter.body} onChange={(e) => edit({ body: e.target.value })} rows={14} className="bg-background max-h-[60vh] text-[13px] leading-relaxed" />
            <span className="text-muted-foreground text-right text-[11px] tabular-nums">{letter.body.split(/\s+/).filter(Boolean).length} words</span>
          </div>
          <div className="grid gap-1.5">
            <div className="flex items-center gap-1">
              <Label className="text-muted-foreground text-xs">{ENCLOSURES[lang].label}</Label>
              <InfoTip label="About enclosures">Comma-separated. Printed under the signature.</InfoTip>
            </div>
            <Input
              value={letter.enclosures ?? ''}
              onChange={(e) => edit({ enclosures: e.target.value })}
              className="bg-background"
              placeholder={lang === 'de' ? 'Lebenslauf, Zeugnisse, Immatrikulationsbescheinigung' : 'CV, transcript'}
            />
          </div>
          {letter.notes && (
            <p
              className={cn(
                'rounded-lg px-2.5 py-2 text-xs whitespace-pre-line',
                warning ? 'bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200' : 'text-muted-foreground bg-background',
              )}
            >
              {warning && <TriangleAlert className="mr-1 inline size-3.5 align-[-2px]" />}
              {letter.notes}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {!inlinePreview && (
              <Button size="sm" variant="outline" onClick={() => setPreview(true)}>
                <Eye /> Preview
              </Button>
            )}
            <Button size="sm" onClick={() => void pdf()} disabled={busy !== null}>
              {busy === 'pdf' ? <Loader2 className="animate-spin" /> : <Download />}
              PDF ({lang.toUpperCase()})
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void copyText()} title="Copy the subject and text">
              <Copy /> Copy text
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void writeWithAi()} disabled={busy !== null || !aiOn} title="Replace with a new AI draft">
              {busy === 'ai' ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              {busy === 'ai' ? progress : 'Rewrite'}
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              className="text-destructive hover:text-destructive ml-auto"
              title="Delete this letter"
              onClick={() =>
                update(app.id, (d) => {
                  if (d.letters) delete d.letters[lang]
                })
              }
            >
              <Trash2 />
            </Button>
          </div>
        </>
      )}
      {letter && !inlinePreview && <LetterPreview open={preview} onOpenChange={setPreview} app={app} letter={letter} lang={lang} />}
    </div>
  )
}

function LetterPreview({
  open,
  onOpenChange,
  app,
  letter,
  lang,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  app: Application
  letter: CoverLetter
  lang: Lang
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{letter.subject}</DialogTitle>
          <DialogDescription>Preview in the letter's design (the Letters page changes it). The PDF looks the same.</DialogDescription>
        </DialogHeader>
        {open && <LetterSheet app={app} letter={letter} lang={lang} />}
      </DialogContent>
    </Dialog>
  )
}

/** The letter as an A4 sheet scaled to the available width, in its design over the style of the application's CV (or the master). */
export function LetterSheet({ app, letter, lang }: { app: Application; letter: CoverLetter; lang: Lang }) {
  const cv = useLetterCv(app)
  const box = useRef<HTMLDivElement>(null)
  const sheet = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [height, setHeight] = useState(0)

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setWidth(el.getBoundingClientRect().width)
      if (sheet.current) setHeight(sheet.current.offsetHeight)
    })
    ro.observe(el)
    if (sheet.current) ro.observe(sheet.current)
    return () => ro.disconnect()
  })

  const content = cv ? (cv.content[lang] ?? cv.content[cv.sourceLang]) : undefined
  const scale = width ? width / SHEET_WIDTH : 0

  return (
    <div ref={box} className="w-full">
      {content && cv && scale > 0 && (
        <div style={{ height: Math.max(height, (SHEET_WIDTH * 297) / 210) * scale }} className="overflow-hidden rounded-sm bg-white shadow-md">
          <div ref={sheet} style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: SHEET_WIDTH }}>
            <LetterDocument letter={letter} personal={content.personal} style={letterStyleOf(cv.style, app.letterStyle, letterLayoutOf(letter, lang))} lang={lang} />
          </div>
        </div>
      )}
    </div>
  )
}

/** The CV a card's letters take their name, contacts and base style from: the linked CV, else the master. */
export function useLetterCv(app: Application): Resume | null {
  const list = useEditor((s) => s.list)
  const [cv, setCv] = useState<Resume | null>(null)
  useLayoutEffect(() => {
    const id = app.resumeId ?? list.find((m) => m.kind === 'master')?.id
    if (id && cv?.id !== id) void api.get(id).then(setCv).catch(() => undefined)
  }, [app.resumeId, list, cv?.id])
  return cv
}
