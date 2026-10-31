import { useLayoutEffect, useRef, type KeyboardEvent } from 'react'
import { Bold, Italic, Link2, List } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Plain textarea with a tiny markdown toolbar: **bold**, _italic_, "- " bullets, [links](url).
 * The CV templates render the same syntax.
 */
export function RichTextarea({
  value,
  onChange,
  placeholder,
  minRows = 3,
  className,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  minRows?: number
  className?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + 2}px`
  }, [value])

  const edit = (fn: (text: string, start: number, end: number) => { text: string; start: number; end: number }) => {
    const el = ref.current
    if (!el) return
    const r = fn(value, el.selectionStart, el.selectionEnd)
    onChange(r.text)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(r.start, r.end)
    })
  }

  const wrap = (marker: string) =>
    edit((text, start, end) => {
      const selected = text.slice(start, end) || 'text'
      const already = text.slice(start - marker.length, start) === marker && text.slice(end, end + marker.length) === marker
      if (already) {
        return {
          text: text.slice(0, start - marker.length) + selected + text.slice(end + marker.length),
          start: start - marker.length,
          end: end - marker.length,
        }
      }
      return {
        text: text.slice(0, start) + marker + selected + marker + text.slice(end),
        start: start + marker.length,
        end: start + marker.length + selected.length,
      }
    })

  const bullets = () =>
    edit((text, start, end) => {
      const lineStart = text.lastIndexOf('\n', start - 1) + 1
      const lineEndIdx = text.indexOf('\n', end)
      const lineEnd = lineEndIdx === -1 ? text.length : lineEndIdx
      const lines = text.slice(lineStart, lineEnd).split('\n')
      const allBullets = lines.every((l) => /^\s*[-•]\s+/.test(l) || !l.trim())
      const next = lines.map((l) => (allBullets ? l.replace(/^\s*[-•]\s+/, '') : l.trim() ? `- ${l.replace(/^\s*[-•]\s+/, '')}` : l))
      const block = next.join('\n')
      return { text: text.slice(0, lineStart) + block + text.slice(lineEnd), start: lineStart, end: lineStart + block.length }
    })

  const link = () =>
    edit((text, start, end) => {
      const label = text.slice(start, end) || 'link'
      const md = `[${label}](https://)`
      return { text: text.slice(0, start) + md + text.slice(end), start: start + label.length + 3, end: start + md.length - 1 }
    })

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(e.ctrlKey || e.metaKey)) {
      // Continue bullet lists on Enter.
      if (e.key === 'Enter' && !e.shiftKey) {
        const el = e.currentTarget
        const lineStart = value.lastIndexOf('\n', el.selectionStart - 1) + 1
        const line = value.slice(lineStart, el.selectionStart)
        if (/^\s*[-•]\s+\S/.test(line)) {
          e.preventDefault()
          edit((text, start, end) => ({ text: text.slice(0, start) + '\n- ' + text.slice(end), start: start + 3, end: start + 3 }))
        } else if (/^\s*[-•]\s*$/.test(line)) {
          e.preventDefault()
          edit((text, _start, end) => ({ text: text.slice(0, lineStart) + text.slice(end), start: lineStart, end: lineStart }))
        }
      }
      return
    }
    const key = e.key.toLowerCase()
    if (key === 'b') {
      e.preventDefault()
      wrap('**')
    } else if (key === 'i') {
      e.preventDefault()
      wrap('_')
    }
  }

  const tool = 'text-muted-foreground hover:bg-muted hover:text-foreground grid size-7 place-items-center rounded-md transition-colors'

  return (
    <div
      className={cn(
        'border-input focus-within:border-ring focus-within:ring-ring/50 rounded-lg border bg-transparent transition-[color,box-shadow] focus-within:ring-3',
        className,
      )}
    >
      <div className="flex items-center gap-0.5 border-b px-1.5 py-1">
        <button type="button" className={tool} title="Bold (Ctrl+B)" onMouseDown={(e) => e.preventDefault()} onClick={() => wrap('**')}>
          <Bold className="size-3.5" />
        </button>
        <button type="button" className={tool} title="Italic (Ctrl+I)" onMouseDown={(e) => e.preventDefault()} onClick={() => wrap('_')}>
          <Italic className="size-3.5" />
        </button>
        <button type="button" className={tool} title="Bullet list" onMouseDown={(e) => e.preventDefault()} onClick={bullets}>
          <List className="size-3.5" />
        </button>
        <button type="button" className={tool} title="Link" onMouseDown={(e) => e.preventDefault()} onClick={link}>
          <Link2 className="size-3.5" />
        </button>
        <span className="text-muted-foreground ml-auto pr-1 text-[11px]">**bold** · _italic_ · - bullet</span>
      </div>
      <textarea
        ref={ref}
        value={value}
        rows={minRows}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        className="placeholder:text-muted-foreground block w-full resize-none bg-transparent px-2.5 py-2 text-base leading-relaxed outline-none md:text-sm"
      />
    </div>
  )
}
