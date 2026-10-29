import { memo, useMemo, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, Check, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { ACCENTS, FONTS, TEMPLATE_MAP, TEMPLATES } from '@shared/templates'
import type { Lang, Placement, ResumeContent, ResumeStyle, TemplateId } from '@shared/types'
import { applyTemplatePlacement, clone } from '@shared/utils'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import { ResumeDocument, SHEET_WIDTH } from '@/resume/ResumeDocument'
import { sectionTitle } from '@/templates/shared'
import { placementLabels } from '../content/SectionCard'
import { SECTION_ICON } from '../sectionIcons'
import { moveInArray, reorder, useEditor } from '../store'

export function Card({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-2xl bg-card ring-hairline p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] ring-1">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-[15px] font-bold tracking-wide uppercase">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

export function Row({ label, value, children }: { label: string; value?: string; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-foreground/80">{label}</span>
        {value && <span className="text-muted-foreground text-xs tabular-nums">{value}</span>}
      </div>
      {children}
    </div>
  )
}

const THUMB_WIDTH = 150

const TemplateThumb = memo(function TemplateThumb({
  id,
  content,
  photo,
  lang,
}: {
  id: TemplateId
  content: ResumeContent
  photo: string
  lang: Lang
}) {
  const scale = THUMB_WIDTH / SHEET_WIDTH
  // Preview each template with its own recommended column layout.
  const laidOut = useMemo(() => {
    const c = clone(content)
    applyTemplatePlacement(c, id)
    return c
  }, [content, id])
  return (
    <div className="pointer-events-none relative overflow-hidden bg-white" style={{ width: THUMB_WIDTH, height: THUMB_WIDTH * (297 / 210) }}>
      <div className="absolute top-0 left-0 origin-top-left" style={{ width: SHEET_WIDTH, transform: `scale(${scale})` }}>
        <ResumeDocument template={id} style={TEMPLATE_MAP[id].style} photo={photo} content={laidOut} lang={lang} />
      </div>
    </div>
  )
})

export default function CustomizePanel() {
  const resume = useEditor((s) => s.resume)
  const lang = useEditor((s) => s.lang)
  if (!resume) return null
  const content = resume.content[lang] ?? resume.content[resume.sourceLang]!
  const style = resume.style
  const meta = TEMPLATE_MAP[resume.template]
  const { update, updateAllLangs } = useEditor.getState()

  const setStyle = <K extends keyof ResumeStyle>(key: K, value: ResumeStyle[K]) =>
    update((d) => {
      d.style[key] = value
    })

  const chooseTemplate = (id: TemplateId) => {
    if (id === resume.template) return
    const before = { template: resume.template, style: clone(resume.style), content: clone(resume.content) }
    update((d) => {
      d.template = id
      d.style = { ...TEMPLATE_MAP[id].style, showPhoto: TEMPLATE_MAP[id].style.showPhoto && !!d.photo }
      for (const c of Object.values(d.content)) if (c) applyTemplatePlacement(c, id)
    })
    toast(`${TEMPLATE_MAP[id].name} applied`, {
      description: 'Colours, fonts, spacing and column layout were reset to the template defaults.',
      action: {
        label: 'Undo',
        onClick: () =>
          update((d) => {
            d.template = before.template
            d.style = before.style
            d.content = before.content
          }),
      },
    })
  }

  const placements = placementLabels(meta.layout)

  return (
    <div className="flex flex-col gap-3">
      <Card title="Template">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {TEMPLATES.map((t) => (
            <button key={t.id} type="button" onClick={() => chooseTemplate(t.id)} className="group text-left">
              <div
                className={cn(
                  'ring-foreground/10 group-hover:ring-foreground/40 relative overflow-hidden rounded-lg ring-1 transition-all group-hover:ring-2',
                  t.id === resume.template && 'ring-foreground group-hover:ring-foreground ring-2',
                )}
              >
                <TemplateThumb id={t.id} content={content} photo={resume.photo} lang={lang} />
                {t.id === resume.template && (
                  <span className="bg-primary text-primary-foreground absolute top-2 right-2 grid size-6 place-items-center rounded-full">
                    <Check className="size-3.5" />
                  </span>
                )}
              </div>
              <div className="mt-1.5 text-sm font-semibold">{t.name}</div>
              <div className="text-muted-foreground line-clamp-2 text-xs">{t.description}</div>
            </button>
          ))}
        </div>
      </Card>

      <Card
        title="Colours"
        action={
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() =>
              update((d) => {
                d.style = { ...meta.style, showPhoto: d.style.showPhoto }
              })
            }
          >
            <RotateCcw /> Reset style
          </Button>
        }
      >
        <div className="grid gap-4">
          <Row label="Accent">
            <div className="flex flex-wrap items-center gap-2">
              {[meta.style.accent, ...ACCENTS.filter((a) => a !== meta.style.accent)].map((c) => (
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
            <Row label="Heading font">
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
            <Slider min={7.5} max={12} step={0.25} value={[style.fontSize]} onValueChange={([v]) => setStyle('fontSize', v)} />
          </Row>
          <Row label="Line height" value={style.lineHeight.toFixed(2)}>
            <Slider min={1} max={1.8} step={0.01} value={[style.lineHeight]} onValueChange={([v]) => setStyle('lineHeight', v)} />
          </Row>
        </div>
      </Card>

      <Card title="Spacing">
        <div className="grid gap-5">
          <div className="grid grid-cols-2 gap-5">
            <Row label="Side margins" value={`${style.marginX}mm`}>
              <Slider min={5} max={25} step={0.5} value={[style.marginX]} onValueChange={([v]) => setStyle('marginX', v)} />
            </Row>
            <Row label="Top & bottom" value={`${style.marginY}mm`}>
              <Slider min={5} max={25} step={0.5} value={[style.marginY]} onValueChange={([v]) => setStyle('marginY', v)} />
            </Row>
            <Row label="Between sections" value={`${style.sectionGap}px`}>
              <Slider min={4} max={32} step={0.5} value={[style.sectionGap]} onValueChange={([v]) => setStyle('sectionGap', v)} />
            </Row>
            <Row label="Between entries" value={`${style.itemGap}px`}>
              <Slider min={2} max={24} step={0.5} value={[style.itemGap]} onValueChange={([v]) => setStyle('itemGap', v)} />
            </Row>
          </div>
          {meta.layout !== 'single' && (
            <Row label={meta.layout === 'sidebar' ? 'Sidebar width' : 'Left column width'} value={`${style.columnRatio}%`}>
              <Slider min={22} max={70} step={1} value={[style.columnRatio]} onValueChange={([v]) => setStyle('columnRatio', v)} />
            </Row>
          )}
        </div>
      </Card>

      <Card title="Header, photo & icons">
        <div className="grid gap-4">
          <label className="flex items-center justify-between text-sm">
            <span className="text-foreground/80">Centred name and contacts</span>
            <Switch checked={style.headerAlign === 'center'} onCheckedChange={(v) => setStyle('headerAlign', v ? 'center' : 'left')} />
          </label>
          <label className="flex items-center justify-between text-sm">
            <span className="text-foreground/80">Show photo</span>
            <Switch checked={style.showPhoto} onCheckedChange={(v) => setStyle('showPhoto', v)} disabled={!resume.photo} />
          </label>
          <Row label="Photo size" value={`${style.photoSize}px`}>
            <Slider
              min={50}
              max={170}
              step={1}
              disabled={!style.showPhoto}
              value={[style.photoSize]}
              onValueChange={([v]) => setStyle('photoSize', v)}
            />
          </Row>
          <label className="flex items-center justify-between text-sm">
            <span className="text-foreground/80">Contact icons (Steady and serif templates)</span>
            <Switch checked={style.showIcons} onCheckedChange={(v) => setStyle('showIcons', v)} />
          </label>
        </div>
      </Card>

      <Card title="Section layout">
        <p className="text-muted-foreground -mt-2 mb-3 text-xs">
          {meta.layout === 'single'
            ? 'This template stacks every section in one column. Order applies to all languages.'
            : 'Choose where each section goes. Consecutive left/right sections share a two-column block.'}
        </p>
        <div className="flex flex-col divide-y">
          {content.sections.map((s, i) => {
            const Icon = SECTION_ICON[s.type]
            return (
              <div key={s.id} className="flex items-center gap-2 py-2">
                <Icon className="text-muted-foreground size-4 shrink-0" />
                <span className={cn('min-w-0 flex-1 truncate text-sm', !s.visible && 'text-muted-foreground line-through')}>
                  {sectionTitle(s, lang)}
                </span>
                {meta.layout !== 'single' && (
                  <ToggleGroup
                    type="single"
                    size="sm"
                    variant="outline"
                    value={s.placement}
                    onValueChange={(v) =>
                      v &&
                      updateAllLangs((c) => {
                        const target = c.sections.find((x) => x.id === s.id)
                        if (target) target.placement = v as Placement
                      })
                    }
                  >
                    {Object.entries(placements).map(([value, label]) => (
                      <ToggleGroupItem key={value} value={value} className="px-2 text-xs">
                        {label.split(' ')[0]}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                )}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={i === 0}
                  onClick={() =>
                    updateAllLangs((c) => {
                      c.sections = reorder(c.sections, moveInArray(content.sections, s.id, -1))
                    })
                  }
                >
                  <ArrowUp />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={i === content.sections.length - 1}
                  onClick={() =>
                    updateAllLangs((c) => {
                      c.sections = reorder(c.sections, moveInArray(content.sections, s.id, 1))
                    })
                  }
                >
                  <ArrowDown />
                </Button>
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
}

export function ColorInput({ value, onChange, wide }: { value: string; onChange: (v: string) => void; wide?: boolean }) {
  return (
    <label
      className={cn(
        'border-input flex h-8 cursor-pointer items-center gap-2 text-muted-foreground rounded-lg border px-1.5 text-xs',
        wide ? 'w-full' : '',
      )}
    >
      <span className="ring-foreground/15 size-5 rounded-md ring-1" style={{ background: value }} />
      <span className="font-mono uppercase">{value}</span>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="sr-only" />
    </label>
  )
}
