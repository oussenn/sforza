import type { Lang } from '@shared/types'

/**
 * Downloads the CV as a real PDF rendered server-side by headless Chrome (selectable text, embedded
 * fonts, clickable links). Falls back to the browser print dialog if the server cannot render it.
 */
export async function downloadPdf(opts: { id?: string; lang: Lang; fileName: string }): Promise<'server' | 'print'> {
  const url = opts.id ? `/api/pdf/${encodeURIComponent(opts.id)}?lang=${opts.lang}` : `/api/pdf?lang=${opts.lang}`
  try {
    const res = await fetch(url, { credentials: 'same-origin' })
    if (!res.ok || !res.headers.get('content-type')?.includes('pdf')) throw new Error(`PDF request failed (${res.status})`)
    const blob = await res.blob()
    const href = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = href
    a.download = `${opts.fileName}.pdf`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(href), 30_000)
    return 'server'
  } catch (err) {
    console.warn('Server-side PDF failed, falling back to the print dialog', err)
    await document.fonts.ready.catch(() => undefined)
    window.print()
    return 'print'
  }
}

/** Downloads the server-rendered PDF of an application's motivation letter. */
export async function downloadLetterPdf(applicationId: string, lang: Lang): Promise<void> {
  const res = await fetch(`/api/applications/${encodeURIComponent(applicationId)}/letter.pdf?lang=${lang}`, { credentials: 'same-origin' })
  if (!res.ok || !res.headers.get('content-type')?.includes('pdf')) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `PDF request failed (${res.status})`)
  }
  // The server names the file ("…_Anschreiben_Data_Engineer_DE.pdf").
  const fileName = res.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] ?? `Letter_${lang.toUpperCase()}.pdf`
  const href = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = href
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(href), 30_000)
}
