import { memo, useMemo } from 'react'
import { Check, RotateCcw } from 'lucide-react'
import { ACCENTS, FONTS } from '@shared/templates'
import type { Application, CoverLetter, Lang, LetterLayout, LetterStyle, Personal } from '@shared/types'
import { LETTER_LAYOUT_DESCRIPTIONS, LETTER_LAYOUT_LABELS, LETTER_LAYOUTS } from '@shared/types'
import { LETTER_STYLE_LIMITS, letterLayoutOf, letterStyleOf } from '@shared/utils'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'
import { LetterDocument } from '@/resume/LetterDocument'
import { SHEET_WIDTH } from '@/resume/ResumeDocument'
import { useLetterCv } from '../applications/LetterSection'
import { useApplications } from '../applications/store'
import { Card, ColorInput, Row } from '../customize/CustomizePanel'

const THUMB_WIDTH = 132

const LetterThumb = memo(function LetterThumb({ letter, personal, style, lang }: { letter: CoverLetter; personal: Personal; style: LetterStyle; lang: Lang }) {
  return (
    <div className="pointer-events-none relative overflow-hidden bg-white" style={{ width: THUMB_WIDTH, height: THUMB_WIDTH * (297 / 210) }}>
      <div className="absolute top-0 left-0 origin-top-left" style={{ width: SHEET_WIDTH, transform: `scale(${THUMB_WIDTH / SHEET_WIDTH})` }}>
        <LetterDocument letter={letter} personal={personal} style={style} lang={lang} />
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

  const personal = cv ? (cv.content[lang] ?? cv.content[cv.sourceLang])!.personal : null
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
                <LetterThumb letter={t.letter} personal={personal} style={t.style} lang={lang} />
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
