import { Fragment, type ReactNode } from 'react'

/**
 * Tiny markdown subset used in CV text fields:
 *   **bold**, *italic* / _italic_, ***bold italic***, [text](url)
 *   lines starting with "- " / "• " are bullets; other lines are paragraphs.
 */

type Inline = string | { t: 'b' | 'i' | 'bi'; c: Inline[] } | { t: 'a'; href: string; c: Inline[] }

const WORD = /[\p{L}\p{N}]/u

function closing(s: string, from: number, marker: string): number {
  for (let i = from; i < s.length; i++) {
    if (!s.startsWith(marker, i)) continue
    if (s[i - 1] === ' ') continue
    if (marker === '_' && WORD.test(s[i + 1] ?? '')) continue
    if (marker === '*' && s[i + 1] === '*') {
      i++
      continue
    }
    return i
  }
  return -1
}

function parseInline(s: string): Inline[] {
  const out: Inline[] = []
  let buf = ''
  const flush = () => {
    if (buf) out.push(buf)
    buf = ''
  }
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (ch === '[') {
      const m = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(s.slice(i))
      if (m) {
        flush()
        out.push({ t: 'a', href: m[2], c: parseInline(m[1]) })
        i += m[0].length
        continue
      }
    }
    if (s.startsWith('***', i) && s[i + 3] && s[i + 3] !== ' ') {
      const end = s.indexOf('***', i + 3)
      if (end > i + 3) {
        flush()
        out.push({ t: 'bi', c: parseInline(s.slice(i + 3, end)) })
        i = end + 3
        continue
      }
    }
    if (s.startsWith('**', i) && s[i + 2] && s[i + 2] !== ' ') {
      const end = closing(s, i + 3, '**')
      if (end > i + 2) {
        flush()
        out.push({ t: 'b', c: parseInline(s.slice(i + 2, end)) })
        i = end + 2
        continue
      }
    }
    if ((ch === '*' || ch === '_') && s[i + 1] && s[i + 1] !== ' ' && !(ch === '_' && WORD.test(s[i - 1] ?? ''))) {
      const end = closing(s, i + 2, ch)
      if (end > i + 1) {
        flush()
        out.push({ t: 'i', c: parseInline(s.slice(i + 1, end)) })
        i = end + 1
        continue
      }
    }
    buf += ch
    i++
  }
  flush()
  return out
}

function renderInline(nodes: Inline[]): ReactNode {
  return nodes.map((n, i) => {
    if (typeof n === 'string') return <Fragment key={i}>{n}</Fragment>
    switch (n.t) {
      case 'b':
        return <strong key={i}>{renderInline(n.c)}</strong>
      case 'i':
        return <em key={i}>{renderInline(n.c)}</em>
      case 'bi':
        return (
          <strong key={i}>
            <em>{renderInline(n.c)}</em>
          </strong>
        )
      case 'a':
        return (
          <a key={i} href={n.href} target="_blank" rel="noreferrer">
            {renderInline(n.c)}
          </a>
        )
    }
  })
}

export function InlineText({ text }: { text: string }) {
  return <>{renderInline(parseInline(text))}</>
}

/** Plain text (markup stripped), e.g. for titles and search. */
export function plainText(text: string): string {
  const walk = (nodes: Inline[]): string => nodes.map((n) => (typeof n === 'string' ? n : walk(n.c))).join('')
  return walk(parseInline(text))
}

type Block = { kind: 'bullet' | 'para'; text: string }

const BULLET = /^\s*(?:[-•*])\s+/

function parseBlocks(text: string): Block[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => (BULLET.test(line) ? { kind: 'bullet', text: line.replace(BULLET, '') } : { kind: 'para', text: line.trim() }))
}

/**
 * Renders multi-line rich text. Every bullet and paragraph is a pagination block (`data-block`)
 * so page breaks never cut through a line.
 */
export function RichText({ text, className }: { text: string; className?: string }) {
  const blocks = parseBlocks(text)
  if (!blocks.length) return null
  const groups: Block[][] = []
  for (const b of blocks) {
    const last = groups[groups.length - 1]
    if (last && last[0].kind === b.kind && b.kind === 'bullet') last.push(b)
    else groups.push([b])
  }
  return (
    <div className={['rt', className].filter(Boolean).join(' ')}>
      {groups.map((g, gi) =>
        g[0].kind === 'bullet' ? (
          <ul key={gi} className="rt-ul">
            {g.map((b, i) => (
              <li key={i} className="rt-li" data-block="">
                <InlineText text={b.text} />
              </li>
            ))}
          </ul>
        ) : (
          <p key={gi} className="rt-p" data-block="">
            <InlineText text={g[0].text} />
          </p>
        ),
      )}
    </div>
  )
}
