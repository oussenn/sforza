import { useEffect, useRef, useState } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { ResumeDocument, type DocProps } from './ResumeDocument'

/**
 * Renders an unscaled copy of the resume only while printing (Download button or Ctrl+P).
 * The document title becomes the suggested PDF file name.
 */
export function PrintPortal({ doc, fileName }: { doc: DocProps | null; fileName: string }) {
  const [printing, setPrinting] = useState(false)
  const nameRef = useRef(fileName)
  useEffect(() => {
    nameRef.current = fileName
  }, [fileName])

  useEffect(() => {
    let previous = document.title
    const before = () => {
      previous = document.title
      document.title = nameRef.current
      flushSync(() => setPrinting(true))
    }
    const after = () => {
      document.title = previous
      setPrinting(false)
    }
    window.addEventListener('beforeprint', before)
    window.addEventListener('afterprint', after)
    return () => {
      window.removeEventListener('beforeprint', before)
      window.removeEventListener('afterprint', after)
    }
  }, [])

  if (!printing || !doc) return null
  return createPortal(
    <div id="print-root">
      <ResumeDocument {...doc} />
    </div>,
    document.body,
  )
}
