import { useEffect, type CSSProperties } from 'react'
import type { Contact, CoverLetter, Lang, LetterStyle, Personal } from '@shared/types'
import { ENCLOSURES, cityOf, enclosureLines, letterDateLine, letterLayoutOf } from '@shared/utils'
import { ensureFont } from '@/lib/fonts'
import { PAGE_HEIGHT, SHEET_WIDTH } from './ResumeDocument'

export interface LetterProps {
  letter: CoverLetter
  personal: Personal
  /** the resolved look (letterStyleOf): the card's own choices over the linked CV's style */
  style: LetterStyle
  lang: Lang
}

const pt = (v: number) => (v * 96) / 72

/** A motivation letter on A4 in one of the letter templates: DIN 5008, Modern, Classic, Banner or Sidebar. */
export function LetterDocument(props: LetterProps) {
  const { style, letter, lang } = props
  useEffect(() => {
    void ensureFont(style.font)
    if (style.headingFont) void ensureFont(style.headingFont)
  }, [style.font, style.headingFont])
  const Layout = { din5008: DinLetter, modern: ModernLetter, classic: ClassicLetter, banner: BannerLetter, sidebar: SidebarLetter }[letterLayoutOf(letter, lang)]
  return <Layout {...props} />
}

const paragraphsOf = (body: string) =>
  body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)

/** Font size, line and paragraph spacing in px. */
const metrics = (style: LetterStyle) => {
  const fs = pt(style.fontSize)
  const line = fs * style.lineHeight
  return { fs, line, gap: line * style.paragraphGap }
}

const headingFont = (style: LetterStyle) => `"${style.headingFont || style.font}", sans-serif`

const sheet = (style: LetterStyle): CSSProperties => ({
  position: 'relative',
  width: SHEET_WIDTH,
  minHeight: PAGE_HEIGHT,
  boxSizing: 'border-box',
  background: style.background,
  color: style.text,
  fontFamily: `"${style.font}", sans-serif`,
  fontSize: pt(style.fontSize),
  lineHeight: style.lineHeight,
  // ligatures drop out of the PDF text layer ("verication")
  fontVariantLigatures: 'none',
  WebkitPrintColorAdjust: 'exact',
  printColorAdjust: 'exact',
})

/** White on a dark accent, the text colour on a light one. */
function onAccent(style: LetterStyle): string {
  const n = parseInt(style.accent.slice(1), 16)
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 165 ? style.text : '#ffffff'
}

const tint = (style: LetterStyle, percent: number) => `color-mix(in srgb, ${style.accent} ${percent}%, ${style.background})`

function ContactItem({ c, style }: { c: Contact; style?: CSSProperties }) {
  return c.url ? (
    <a href={c.url} style={{ color: 'inherit', textDecoration: 'none', ...style }}>
      {c.value}
    </a>
  ) : (
    <span style={style}>{c.value}</span>
  )
}

function Paragraphs({ letter, gap }: { letter: CoverLetter; gap: number }) {
  const paragraphs = paragraphsOf(letter.body)
  return (
    <>
      {paragraphs.map((p, i) => (
        <p key={i} style={{ margin: i < paragraphs.length - 1 ? `0 0 ${gap}px` : 0, whiteSpace: 'pre-line' }}>
          {p}
        </p>
      ))}
    </>
  )
}

function Enclosures({ letter, lang, gap }: { letter: CoverLetter; lang: Lang; gap: number }) {
  const lines = enclosureLines(letter.enclosures)
  if (!lines.length) return null
  return (
    <div style={{ marginTop: gap }}>
      <div style={{ fontWeight: 700 }}>{ENCLOSURES[lang].label}</div>
      {lines.map((l, i) => (
        <div key={i}>{l}</div>
      ))}
    </div>
  )
}

/** Recipient and date side by side, the subject, the text, the name and the enclosures. */
function LetterBody({ letter, personal, style, lang, dateAside = true }: LetterProps & { dateAside?: boolean }) {
  const { fs, gap } = metrics(style)
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: fs * 2 }}>
        <div style={{ whiteSpace: 'pre-line' }}>{letter.recipient}</div>
        {dateAside && <div style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>{letterDateLine(letter.date, lang, cityOf({ personal }))}</div>}
      </div>
      <div style={{ fontWeight: 700, margin: `${fs * 2}px 0 ${fs * 1.2}px` }}>{letter.subject}</div>
      <Paragraphs letter={letter} gap={gap} />
      <p style={{ margin: `${fs * 1.4}px 0 0` }}>{personal.name}</p>
      <Enclosures letter={letter} lang={lang} gap={fs * 1.4} />
    </>
  )
}

/**
 * DIN 5008, form B (the German business-letter standard): 25 mm left and 20 mm right margins, sender in the
 * letterhead, the address field where a window envelope shows it (45 mm from the top, 85 × 45 mm, with the
 * return line in its top zone), date flush right, bold subject without the word "Betreff", blank lines as the
 * standard spaces them, and fold and punch marks at 105, 148.5 and 210 mm. Fonts, colours and the text's size
 * and spacing follow the style; the margins and fields stay where the standard puts them.
 */
function DinLetter({ letter, personal, style, lang }: LetterProps) {
  const { line, gap } = metrics(style)
  const contacts = personal.contacts.filter((c) => c.value)
  const city = cityOf({ personal })
  const returnLine = [personal.name, contacts.find((c) => c.type === 'location')?.value].filter(Boolean).join(' · ')

  return (
    <div className="letter-sheet letter-din" style={{ ...sheet(style), padding: '0 20mm 20mm 25mm' }}>
      {/* Fold and punch marks; only these are positioned, since positioned text lands at the end of the PDF's reading order. */}
      {[105, 148.5, 210].map((y) => (
        <span
          key={y}
          aria-hidden
          style={{ position: 'absolute', left: '4mm', top: `${y}mm`, width: y === 148.5 ? '7mm' : '5mm', borderTop: '0.5pt solid #9b9b9b' }}
        />
      ))}

      {/* In normal flow with fixed heights, so the PDF text reads top to bottom. Letterhead: the top 45 mm. */}
      <header style={{ height: '45mm', boxSizing: 'border-box', paddingTop: '14mm', textAlign: 'right' }}>
        <div style={{ fontFamily: headingFont(style), fontSize: pt(16), fontWeight: 700, color: style.accent, lineHeight: 1.15 }}>{personal.name}</div>
        <div style={{ fontSize: pt(9), lineHeight: 1.35, marginTop: '1.5mm', display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', columnGap: '1.1em' }}>
          {contacts.map((c) => (
            <ContactItem key={c.id} c={c} style={{ whiteSpace: 'nowrap' }} />
          ))}
        </div>
      </header>

      {/* Address field (45 to 90 mm): return line in the 17.7 mm top zone, recipient in the 27.3 mm address zone */}
      <div style={{ height: '45mm', width: '80mm' }}>
        <div style={{ height: '17.7mm', display: 'flex', alignItems: 'flex-end', fontSize: pt(7.5), paddingBottom: '1mm', boxSizing: 'border-box' }}>
          {returnLine && <span style={{ borderBottom: '0.4pt solid currentColor' }}>{returnLine}</span>}
        </div>
        <div style={{ whiteSpace: 'pre-line', lineHeight: 1.15 }}>{letter.recipient}</div>
      </div>

      {/* From 90 mm: date flush right, then the subject two lines lower */}
      <div>
        <div style={{ textAlign: 'right' }}>{letterDateLine(letter.date, lang, city)}</div>
        <div style={{ fontWeight: 700, marginTop: line }}>{letter.subject}</div>
        <div style={{ marginTop: line * 2 }}>
          <Paragraphs letter={letter} gap={gap} />
        </div>
        {/* three blank lines for the handwritten signature */}
        <div style={{ marginTop: line * 3 }}>{personal.name}</div>
        <Enclosures letter={letter} lang={lang} gap={line} />
      </div>
    </div>
  )
}

/** Name and contacts as a header over a rule in the accent colour, recipient and date side by side. */
function ModernLetter(props: LetterProps) {
  const { personal, style } = props
  const { fs } = metrics(style)
  return (
    <div className="letter-sheet" style={{ ...sheet(style), padding: `${style.marginY}mm ${style.marginX}mm ${style.marginY * 0.9}mm` }}>
      <header style={{ borderBottom: `1.5px solid ${style.accent}`, paddingBottom: fs * 0.7, marginBottom: fs * 2.2 }}>
        <div style={{ fontFamily: headingFont(style), fontSize: fs * 2, fontWeight: 700, color: style.accent, lineHeight: 1.15 }}>{personal.name}</div>
        {personal.headline && <div style={{ fontWeight: 600, marginTop: 2 }}>{personal.headline}</div>}
        <div style={{ fontSize: fs * 0.9, marginTop: fs * 0.35, display: 'flex', flexWrap: 'wrap', columnGap: fs * 0.9 }}>
          {personal.contacts
            .filter((c) => c.value)
            .map((c) => (
              <ContactItem key={c.id} c={c} />
            ))}
        </div>
      </header>
      <LetterBody {...props} />
    </div>
  )
}

/** Centred name, role and contacts between two thin rules; the date above the recipient. */
function ClassicLetter(props: LetterProps) {
  const { letter, personal, style, lang } = props
  const { fs } = metrics(style)
  const rule = `0.75pt solid ${style.accent}`
  const contacts = personal.contacts.filter((c) => c.value)
  return (
    <div className="letter-sheet" style={{ ...sheet(style), padding: `${style.marginY}mm ${style.marginX}mm ${style.marginY * 0.9}mm` }}>
      <header style={{ textAlign: 'center', borderTop: rule, borderBottom: rule, padding: `${fs * 0.9}px 0`, marginBottom: fs * 2 }}>
        <div style={{ fontFamily: headingFont(style), fontSize: fs * 1.9, fontWeight: 600, letterSpacing: '0.04em', lineHeight: 1.15 }}>{personal.name}</div>
        {personal.headline && <div style={{ fontStyle: 'italic', color: style.accent, marginTop: fs * 0.2 }}>{personal.headline}</div>}
        <div style={{ fontSize: fs * 0.88, marginTop: fs * 0.45 }}>
          {contacts.map((c, i) => (
            <span key={c.id} style={{ whiteSpace: 'nowrap' }}>
              {i > 0 && <span style={{ margin: '0 0.5em', color: style.accent }}>·</span>}
              <ContactItem c={c} />
            </span>
          ))}
        </div>
      </header>
      <div style={{ textAlign: 'right', marginBottom: fs * 1.2 }}>{letterDateLine(letter.date, lang, cityOf({ personal }))}</div>
      <LetterBody {...props} dateAside={false} />
    </div>
  )
}

/** Name and role on a full-width band in the accent colour, the contacts on a light strip under it. */
function BannerLetter(props: LetterProps) {
  const { personal, style } = props
  const { fs } = metrics(style)
  return (
    <div className="letter-sheet" style={{ ...sheet(style), padding: 0 }}>
      <header style={{ background: style.accent, color: onAccent(style), padding: `${style.marginY * 0.8}mm ${style.marginX}mm ${style.marginY * 0.55}mm` }}>
        <div style={{ fontFamily: headingFont(style), fontSize: fs * 2.1, fontWeight: 700, lineHeight: 1.15 }}>{personal.name}</div>
        {personal.headline && <div style={{ fontSize: fs * 1.05, marginTop: fs * 0.2, opacity: 0.9 }}>{personal.headline}</div>}
      </header>
      <div
        style={{
          background: tint(style, 9),
          padding: `${fs * 0.55}px ${style.marginX}mm`,
          fontSize: fs * 0.88,
          display: 'flex',
          flexWrap: 'wrap',
          columnGap: fs * 1.2,
        }}
      >
        {personal.contacts
          .filter((c) => c.value)
          .map((c) => (
            <ContactItem key={c.id} c={c} />
          ))}
      </div>
      <div style={{ padding: `${fs * 2}px ${style.marginX}mm ${style.marginY * 0.9}mm` }}>
        <LetterBody {...props} />
      </div>
    </div>
  )
}

/** Name, role, contacts, place and date in a tinted column beside the letter. */
function SidebarLetter(props: LetterProps) {
  const { letter, personal, style, lang } = props
  const { fs } = metrics(style)
  return (
    <div className="letter-sheet" style={{ ...sheet(style), padding: 0, display: 'flex', alignItems: 'stretch' }}>
      <aside style={{ width: '62mm', flexShrink: 0, boxSizing: 'border-box', background: tint(style, 9), padding: `${style.marginY}mm 7mm` }}>
        <div style={{ fontFamily: headingFont(style), fontSize: fs * 1.6, fontWeight: 700, color: style.accent, lineHeight: 1.15 }}>{personal.name}</div>
        {personal.headline && <div style={{ fontSize: fs * 0.92, marginTop: fs * 0.35 }}>{personal.headline}</div>}
        <div style={{ width: fs * 2, height: 2, background: style.accent, margin: `${fs}px 0` }} />
        <div style={{ fontSize: fs * 0.86, lineHeight: 1.5, display: 'grid', rowGap: fs * 0.25 }}>
          {personal.contacts
            .filter((c) => c.value)
            .map((c) => (
              <ContactItem key={c.id} c={c} style={{ overflowWrap: 'anywhere' }} />
            ))}
        </div>
        <div style={{ fontSize: fs * 0.86, marginTop: fs * 1.6 }}>{letterDateLine(letter.date, lang, cityOf({ personal }))}</div>
      </aside>
      <main style={{ flex: 1, minWidth: 0, padding: `${style.marginY}mm ${style.marginX * 0.85}mm ${style.marginY * 0.9}mm 9mm` }}>
        <LetterBody {...props} dateAside={false} />
      </main>
    </div>
  )
}
