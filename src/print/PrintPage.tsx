import { useEffect, useState } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { TEMPLATE_MAP } from '@shared/templates'
import type { Lang, Resume, ResumeStyle } from '@shared/types'
import type { LetterProps } from '@/resume/LetterDocument'
import { LetterDocument } from '@/resume/LetterDocument'
import { api } from '@/lib/api'
import { loadFont } from '@/lib/fonts'
import { fitToPage, type FitResult } from '@/resume/fit'
import { measureLayout, measureLetter, type LayoutReport, type LetterFit } from '@/resume/layout'
import { ResumeDocument } from '@/resume/ResumeDocument'

/** PDF title (document metadata): the person and the kind of document, never the internal CV name. */
const DOC_WORD = {
  resume: { en: 'Resume', fr: 'CV', de: 'Lebenslauf' },
  letter: { en: 'Cover letter', fr: 'Lettre de motivation', de: 'Anschreiben' },
} satisfies Record<string, Record<Lang, string>>

declare global {
  interface Window {
    __PDF_READY?: boolean
    __PDF_ERROR?: string
    /** how the CV or letter sits on its pages, read by the server's layout check */
    __LAYOUT?: LayoutReport | LetterFit
    /** with ?fit=1: the style that fills one page best, read by the server's fit_cv_to_page */
    __FIT?: FitResult
  }
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function pickLang(resume: Resume): Lang {
  const wanted = new URLSearchParams(window.location.search).get('lang') as Lang | null
  return wanted && resume.content[wanted] ? wanted : resume.sourceLang
}

/**
 * Rendered by Cloudflare's headless Chrome (worker/pdf.ts). Loads every font face *before* rendering,
 * so the first layout already uses the final fonts (no invisible text while a face is still swapping),
 * then flags `window.__PDF_READY` once the photo and pagination have settled.
 */
export default function PrintPage() {
  return new URLSearchParams(window.location.search).get('letter') ? <PrintLetter /> : <PrintResume />
}

/** A motivation letter (worker/pdf.ts renderLetterPdf). */
function PrintLetter() {
  const [data, setData] = useState<(LetterProps & { title: string }) | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    ;(async () => {
      const res = await api.printLetter(params.get('letter') ?? '', params.get('lang') ?? '', params.get('token') ?? '')
      await Promise.all([res.style.font, res.style.headingFont].filter(Boolean).map((f) => loadFont(f)))
      setData(res)
    })().catch((err: Error) => {
      window.__PDF_ERROR = err.message
      window.__PDF_READY = true
    })
  }, [])

  useEffect(() => {
    if (!data) return
    ;(async () => {
      await document.fonts.ready
      await nextFrame()
      await sleep(100)
      const sheet = document.querySelector<HTMLElement>('#print-root .letter-sheet')
      if (sheet) window.__LAYOUT = measureLetter(sheet)
      window.__PDF_READY = true
    })()
  }, [data])

  if (!data) return null
  document.title = [data.personal.name, DOC_WORD.letter[data.lang]].filter(Boolean).join(' – ')
  return createPortal(
    <div id="print-root">
      <LetterDocument letter={data.letter} personal={data.personal} style={data.style} lang={data.lang} />
    </div>,
    document.body,
  )
}

function PrintResume() {
  const [resume, setResume] = useState<Resume | null>(null)
  // ?fit=1 renders one candidate style after another (src/resume/fit.ts) and reports the best.
  const [trial, setTrial] = useState<ResumeStyle | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const id = params.get('id')
    const token = params.get('token')
    ;(async () => {
      if (!id || !token) throw new Error('Missing print token')
      const data = await api.printData(id, token)
      await Promise.all([data.style.font, data.style.headingFont].filter(Boolean).map((f) => loadFont(f)))
      setResume(data)
    })().catch((err: Error) => {
      window.__PDF_ERROR = err.message
      window.__PDF_READY = true
    })
  }, [])

  useEffect(() => {
    if (!resume) return
    ;(async () => {
      await Promise.all(Array.from(document.images, (img) => img.decode().catch(() => undefined)))
      await document.fonts.ready
      await nextFrame()
      await sleep(150)
      const sheet = () => document.querySelector<HTMLElement>('#print-root .resume-sheet')
      if (new URLSearchParams(window.location.search).get('fit')) {
        const layout = TEMPLATE_MAP[resume.template]?.layout ?? 'mixed'
        const opts = { columns: layout !== 'single', ratioIsSide: layout === 'sidebar', maxLineHeight: layout === 'single' ? 1.4 : 1.25 }
        window.__FIT = await fitToPage(resume.style, opts, async (style) => {
          // Pagination runs in a layout effect, so the trial is paginated as soon as this render commits.
          flushSync(() => setTrial(style))
          await nextFrame()
          return measureLayout(sheet()!)
        })
      } else if (sheet()) window.__LAYOUT = measureLayout(sheet()!)
      window.__PDF_READY = true
    })().catch((err: Error) => {
      window.__PDF_ERROR = err.message
      window.__PDF_READY = true
    })
  }, [resume])

  if (!resume) return null
  const lang = pickLang(resume)
  const content = resume.content[lang]
  if (!content) return null
  document.title = [content.personal.name, DOC_WORD.resume[lang]].filter(Boolean).join(' – ')
  return createPortal(
    <div id="print-root">
      <ResumeDocument template={resume.template} style={trial ?? resume.style} photo={resume.photo} content={content} lang={lang} />
    </div>,
    document.body,
  )
}
