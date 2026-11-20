import { memo, useMemo, useRef, useState } from 'react'
import { Check, ImageUp, RotateCcw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { ACCENTS, FONTS } from '@shared/templates'
import type { Application, CoverLetter, Lang, LetterLayout, LetterStyle, Personal } from '@shared/types'
import { LETTER_LAYOUT_DESCRIPTIONS, LETTER_LAYOUT_LABELS, LETTER_LAYOUTS, LETTER_LOGO_LAYOUTS } from '@shared/types'
import { LETTER_STYLE_LIMITS, letterLayoutOf, letterPersonal, letterStyleOf } from '@shared/utils'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { api } from '@/lib/api'
import { fitPng } from '@/lib/image'
import { cn } from '@/lib/utils'
import { LetterDocument } from '@/resume/LetterDocument'
import { SHEET_WIDTH } from '@/resume/ResumeDocument'
import { useLetterCv } from '../applications/LetterSection'
import { useApplications } from '../applications/store'
import { useEditor } from '../store'
import { Card, ColorInput, Row } from '../customize/CustomizePanel'

const THUMB_WIDTH = 132

const LetterThumb = memo(function LetterThumb(props: { letter: CoverLetter; personal: Personal; style: LetterStyle; lang: Lang; logo?: string; signature?: string }) {
  return (
    <div className="pointer-events-none relative overflow-hidden bg-white" style={{ width: THUMB_WIDTH, height: THUMB_WIDTH * (297 / 210) }}>
      <div className="absolute top-0 left-0 origin-top-left" style={{ width: SHEET_WIDTH, transform: `scale(${THUMB_WIDTH / SHEET_WIDTH})` }}>
        <LetterDocument {...props} />
      </div>
    </div>
  )
})

/**
 * The look of a card's letters, like the CV's Customize panel: the template of this language's letter, and the
 * fonts, colours and spacing every language of the card shares. What is not changed here follows the linked CV.
 */
export default function LetterDesignPanel({ app, letter, lang }: { app: Application; letter: CoverLetter; lang: Lang }) {
  const cv = useLetterCv(app)
  const { update } = useApplications.getState()
  const layout = letterLayoutOf(letter, lang)
  const own = app.letterStyle ?? {}
  const din = layout === 'din5008'

  const hidden = useEditor((s) => s.searchProfile?.letterHideContacts)
  const signature = useEditor((s) => s.searchProfile?.signature) ?? ''
  const personal = cv ? letterPersonal((cv.content[lang] ?? cv.content[cv.sourceLang])!.personal, hidden) : null
  const style = cv ? letterStyleOf(cv.style, own, layout) : null
  // One thumbnail per template, in this letter's text and the card's style.
  const thumbs = useMemo(
    () =>
      cv
        ? LETTER_LAYOUTS.map((l) => ({ layout: l, letter: { ...letter, layout: l }, style: letterStyleOf(cv.style, app.letterStyle, l) }))
        : [],
    [cv, letter, app.letterStyle],
  )
  if (!cv || !personal || !style) return <p className="text-muted-foreground p-4 text-sm">Loading the CV this letter goes with…</p>

  const setLayout = (l: LetterLayout) =>
    update(app.id, (d) => {
      const current = d.letters?.[lang]
      if (current) d.letters![lang] = { ...current, layout: l, updatedAt: new Date().toISOString() }
    })
  const setStyle = <K extends keyof LetterStyle>(key: K, value: LetterStyle[K]) =>
    update(app.id, (d) => {
      d.letterStyle = { ...d.letterStyle, [key]: value }
    })
  const slider = (key: keyof typeof LETTER_STYLE_LIMITS, step: number, min?: number) => (
    <Slider
      min={min ?? LETTER_STYLE_LIMITS[key][0]}
      max={LETTER_STYLE_LIMITS[key][1]}
      step={step}
      value={[style[key]]}
      onValueChange={([v]) => setStyle(key, v!)}
    />
  )

  return (
    <div className="flex flex-col gap-3">
      <Card title="Template">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {thumbs.map((t) => (
            <button key={t.layout} type="button" onClick={() => setLayout(t.layout)} className="group text-left">
              <div
                className={cn(
                  'ring-foreground/10 group-hover:ring-foreground/40 relative w-fit overflow-hidden rounded-lg ring-1 transition-all group-hover:ring-2',
                  t.layout === layout && 'ring-foreground group-hover:ring-foreground ring-2',
                )}
              >
                <LetterThumb letter={t.letter} personal={personal} style={t.style} lang={lang} logo={app.logo} signature={signature} />
                {t.layout === layout && (
                  <span className="bg-primary text-primary-foreground absolute top-2 right-2 grid size-6 place-items-center rounded-full">
                    <Check className="size-3.5" />
                  </span>
                )}
              </div>
              <div className="mt-1.5 text-sm font-semibold">{LETTER_LAYOUT_LABELS[t.layout]}</div>
              <div className="text-muted-foreground line-clamp-2 text-xs">{LETTER_LAYOUT_DESCRIPTIONS[t.layout]}</div>
            </button>
          ))}
        </div>
        <p className="text-muted-foreground mt-3 text-xs">The template applies to this language's letter. Fonts, colours and spacing below apply to every language of this card.</p>
      </Card>

      <LogoAndSignature app={app} style={style} signature={signature} used={LETTER_LOGO_LAYOUTS.includes(layout)} setStyle={setStyle} />

      <Card
        title="Colours"
        action={
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            disabled={!Object.keys(own).length}
            onClick={() =>
              update(app.id, (d) => {
                d.letterStyle = {}
              })
            }
            title="Fonts, colours and spacing from the CV again"
          >
            <RotateCcw /> Match the CV
          </Button>
        }
      >
        <div className="grid gap-4">
          <Row label="Accent">
            <div className="flex flex-wrap items-center gap-2">
              {[cv.style.accent, ...ACCENTS.filter((a) => a !== cv.style.accent)].map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setStyle('accent', c)}
                  className={cn('ring-offset-background size-7 rounded-full ring-offset-2 transition', style.accent === c && 'ring-foreground ring-2')}
                  style={{ background: c }}
                  title={c}
                />
              ))}
              <ColorInput value={style.accent} onChange={(v) => setStyle('accent', v)} />
            </div>
          </Row>
          <div className="grid grid-cols-2 gap-4">
            <Row label="Text">
              <ColorInput value={style.text} onChange={(v) => setStyle('text', v)} wide />
            </Row>
            <Row label="Page background">
              <ColorInput value={style.background} onChange={(v) => setStyle('background', v)} wide />
            </Row>
          </div>
        </div>
      </Card>

      <Card title="Typography">
        <div className="grid gap-5">
          <div className="grid grid-cols-2 gap-3">
            <Row label="Font">
              <Select value={style.font} onValueChange={(v) => setStyle('font', v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FONTS.map((f) => (
                    <SelectItem key={f} value={f}>
                      {f}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>
            <Row label="Name font">
              <Select value={style.headingFont || '__same'} onValueChange={(v) => setStyle('headingFont', v === '__same' ? '' : v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__same">Same as text</SelectItem>
                  {FONTS.map((f) => (
                    <SelectItem key={f} value={f}>
                      {f}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>
          </div>
          <Row label="Font size" value={`${style.fontSize}pt`}>
            {slider('fontSize', 0.25, din ? 11 : undefined)}
          </Row>
          <Row label="Line height" value={style.lineHeight.toFixed(2)}>
            {slider('lineHeight', 0.01)}
          </Row>
          {din && <p className="text-muted-foreground -mt-2 text-xs">DIN 5008 asks for at least 11 pt.</p>}
        </div>
      </Card>

      <Card title="Spacing">
        <div className="grid gap-5">
          <div className="grid grid-cols-2 gap-5">
            <Row label="Side margins" value={din ? 'DIN' : `${style.marginX}mm`}>
              {din ? <Slider disabled value={[25]} min={12} max={32} /> : slider('marginX', 0.5)}
            </Row>
            <Row label="Top & bottom" value={din ? 'DIN' : `${style.marginY}mm`}>
              {din ? <Slider disabled value={[20]} min={10} max={30} /> : slider('marginY', 0.5)}
            </Row>
          </div>
          <Row label="Between paragraphs" value={`${style.paragraphGap.toFixed(2)} lines`}>
            {slider('paragraphGap', 0.05)}
          </Row>
          {din && <p className="text-muted-foreground -mt-2 text-xs">DIN 5008 sets the margins and where the address and date go.</p>}
        </div>
      </Card>
    </div>
  )
}

/**
 * The two pictures of the Logo & signature template. The company logo is the card's own (found from the posting,
 * the same one the board shows; uploading another changes the card's logo too). The signature belongs to the account:
 * uploaded once, it signs every letter in that template. Each can be left off this card's letters.
 */
function LogoAndSignature({
  app,
  style,
  signature,
  used,
  setStyle,
}: {
  app: Application
  style: LetterStyle
  signature: string
  used: boolean
  setStyle: <K extends keyof LetterStyle>(key: K, value: LetterStyle[K]) => void
}) {
  const { update } = useApplications.getState()
  const [busy, setBusy] = useState<'logo' | 'signature' | null>(null)
  const logoInput = useRef<HTMLInputElement>(null)
  const signatureInput = useRef<HTMLInputElement>(null)

  const upload = async (what: 'logo' | 'signature', picked: File | undefined) => {
    if (!picked) return
    setBusy(what)
    try {
      // A logo is small on the page; a signature keeps enough pixels to print sharp.
      const { url } = await api.uploadImage(await fitPng(picked, what === 'logo' ? 256 : 640))
      if (what === 'logo')
        update(app.id, (d) => {
          d.logo = url
        })
      else
        useEditor.getState().updateSearchProfile((d) => {
          d.signature = url
        })
      toast.success(what === 'logo' ? 'Logo saved on this card' : 'Signature saved for all your letters')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const findLogo = async () => {
    setBusy('logo')
    try {
      await useApplications.getState().flush()
      const found = await api.findLogo(app.id)
      useApplications.getState().replace(found)
      toast[found.logo ? 'success' : 'error'](found.logo ? 'Logo found' : 'No logo found: upload one')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const picture = (src: string, empty: string, wide: boolean) =>
    src ? (
      <img src={src} alt="" className={cn('rounded bg-white object-contain p-1 ring-1 ring-black/10', wide ? 'h-14 w-40' : 'size-14')} />
    ) : (
      <div className={cn('text-muted-foreground grid place-items-center rounded border border-dashed text-center text-[11px] leading-tight', wide ? 'h-14 w-40' : 'size-14')}>{empty}</div>
    )

  return (
    <Card title="Logo & signature">
      <div className="grid gap-5">
        <div className="flex items-center gap-4">
          {picture(app.logo, 'No logo', false)}
          <div className="grid min-w-0 flex-1 gap-1.5">
            <div className="text-sm font-medium">Company logo</div>
            <div className="text-muted-foreground text-xs">The card's logo, found from the posting.</div>
            <div className="flex flex-wrap items-center gap-2">
              {!app.logo && (
                <Button size="sm" variant="outline" disabled={busy === 'logo'} onClick={() => void findLogo()}>
                  Find
                </Button>
              )}
              <Button size="sm" variant="outline" disabled={busy === 'logo'} onClick={() => logoInput.current?.click()}>
                <ImageUp /> {app.logo ? 'Replace' : 'Upload'}
              </Button>
              <label className="flex items-center gap-2 text-xs">
                <Switch checked={style.showLogo} onCheckedChange={(v) => setStyle('showLogo', v)} disabled={!app.logo} /> On the letter
              </label>
            </div>
          </div>
          <input ref={logoInput} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => void upload('logo', e.target.files?.[0])} />
        </div>
        <div className="flex items-center gap-4">
          {picture(signature, 'No signature yet', true)}
          <div className="grid min-w-0 flex-1 gap-1.5">
            <div className="text-sm font-medium">Your signature</div>
            <div className="text-muted-foreground text-xs">A photo or scan on white paper. Saved with your account for every letter.</div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" disabled={busy === 'signature'} onClick={() => signatureInput.current?.click()}>
                <ImageUp /> {signature ? 'Replace' : 'Upload'}
              </Button>
              {signature && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground"
                  onClick={() =>
                    useEditor.getState().updateSearchProfile((d) => {
                      d.signature = ''
                    })
                  }
                >
                  <Trash2 /> Remove
                </Button>
              )}
              <label className="flex items-center gap-2 text-xs">
                <Switch checked={style.showSignature} onCheckedChange={(v) => setStyle('showSignature', v)} disabled={!signature} /> On the letter
              </label>
            </div>
          </div>
          <input ref={signatureInput} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => void upload('signature', e.target.files?.[0])} />
        </div>
        {!used && <p className="text-muted-foreground -mt-1 text-xs">Only the Logo & signature template prints them.</p>}
      </div>
    </Card>
  )
}
