import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react'
import type { Lang, ResumeContent, ResumeStyle, TemplateId } from '@shared/types'
import { orderLanguages } from '@shared/utils'
import { ensureFont } from '@/lib/fonts'
import { TEMPLATE_COMPONENTS } from '@/templates'
import { paginate } from './paginate'

import { PAGE_HEIGHT, SHEET_WIDTH } from './page'

export { PAGE_HEIGHT, SHEET_WIDTH }

export interface DocProps {
  template: TemplateId
  style: ResumeStyle
  photo: string
  content: ResumeContent
  lang: Lang
  onPages?: (pages: number) => void
}

export function styleVars(style: ResumeStyle): CSSProperties {
  const fs = (style.fontSize * 96) / 72
  return {
    '--accent': style.accent,
    '--text': style.text,
    '--bg': style.background,
    '--font': `"${style.font}"`,
    '--hfont': `"${style.headingFont || style.font}"`,
    '--fs': `${fs.toFixed(3)}px`,
    '--lh': `${(fs * style.lineHeight).toFixed(3)}px`,
    // unitless, for templates whose text sizes vary (LaTeX: \small lines scale with the chosen line height)
    '--lhr': style.lineHeight.toFixed(3),
    '--mx': `${style.marginX}mm`,
    '--my': `${style.marginY}mm`,
    '--sgap': `${style.sectionGap}px`,
    '--igap': `${style.itemGap}px`,
    '--igapn': String(style.itemGap),
    '--col': `${style.columnRatio}%`,
    '--photo': `${style.photoSize}px`,
  } as CSSProperties
}

/** One continuous A4-wide sheet, paginated in place (see paginate.ts). */
export const ResumeDocument = memo(function ResumeDocument({ template, style, photo, content, lang, onPages }: DocProps) {
  const ref = useRef<HTMLDivElement>(null)
  const onPagesRef = useRef(onPages)
  const Template = TEMPLATE_COMPONENTS[template] ?? TEMPLATE_COMPONENTS.signature
  const ordered = useMemo(() => orderLanguages(content), [content])

  useLayoutEffect(() => {
    onPagesRef.current = onPages
    void ensureFont(style.font)
    if (style.headingFont) void ensureFont(style.headingFont)
  })

  const run = useCallback(() => {
    const sheet = ref.current
    if (!sheet || !sheet.isConnected) return
    const mm = sheet.offsetWidth / 210
    const metrics = {
      pageHeight: sheet.offsetWidth * (297 / 210),
      top: style.marginY * mm,
      bottom: style.marginY * 0.85 * mm,
    }
    // Blocks that may shrink (language pills) stay full size unless that costs a page.
    const shrinkable = Array.from(sheet.querySelectorAll<HTMLElement>('[data-compact-if-needed]'))
    const compact = (on: boolean) => shrinkable.forEach((el) => (on ? (el.dataset.compact = '') : delete el.dataset.compact))
    compact(false)
    let pages = paginate(sheet, metrics)
    if (pages > 1 && shrinkable.length) {
      compact(true)
      const fewer = paginate(sheet, metrics)
      if (fewer < pages) pages = fewer
      else {
        compact(false)
        pages = paginate(sheet, metrics)
      }
    }
    onPagesRef.current?.(pages)
  }, [style.marginY])

  // Re-paginate after every render (content or style changed) before the browser paints.
  useLayoutEffect(() => {
    run()
  })

  // Web fonts change line wrapping once they arrive.
  useEffect(() => {
    let alive = true
    const rerun = () => alive && run()
    document.fonts.ready.then(rerun).catch(() => {})
    document.fonts.addEventListener('loadingdone', rerun)
    return () => {
      alive = false
      document.fonts.removeEventListener('loadingdone', rerun)
    }
  }, [run])

  return (
    <div ref={ref} className={`resume-sheet tpl-${template}`} style={styleVars(style)} lang={lang} data-header={style.headerAlign === 'center' ? 'center' : undefined}>
      <Template content={ordered} style={style} photo={photo} lang={lang} />
    </div>
  )
})
