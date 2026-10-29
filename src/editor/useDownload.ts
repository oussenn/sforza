import { useState } from 'react'
import { toast } from 'sonner'
import { pdfFileName } from '@shared/utils'
import { downloadPdf } from '@/resume/download'
import { useEditor } from './store'

/** Saves pending edits, then downloads the current CV as a server-rendered PDF. */
export function useDownload() {
  const [busy, setBusy] = useState(false)
  const run = async () => {
    const { resume, lang, flush } = useEditor.getState()
    if (!resume || busy) return
    setBusy(true)
    try {
      await flush()
      const l = resume.content[lang] ? lang : resume.sourceLang
      const how = await downloadPdf({ id: resume.id, lang: l, fileName: pdfFileName(resume, l) })
      if (how === 'print') toast.info('Server PDF unavailable: pick “Save as PDF” in the print dialog to keep links clickable.')
    } finally {
      setBusy(false)
    }
  }
  return { busy, run }
}
