import { useEffect, useState } from 'react'
import { FlaskConical } from 'lucide-react'

const SOURCE_URL = 'https://github.com/oussenn/sforza'

/**
 * Shown while signed in to the public demo: this visitor's own copy of the sample data, and when it is deleted.
 * The server enforces every limit (worker/demo.ts); this only says what to expect.
 */
export default function DemoBanner({ expiresAt }: { expiresAt: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  const minutes = Math.max(0, Math.round((expiresAt * 1000 - now) / 60_000))
  const left = minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`

  return (
    <div
      role="note"
      className="flex shrink-0 items-center justify-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-center text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/60 dark:text-amber-100"
    >
      <FlaskConical className="size-3.5 shrink-0" aria-hidden />
      <span>
        Demo: your own copy of sample data, deleted in {left}. AI, PDF export, uploads and the connector are off.{' '}
        <a href={SOURCE_URL} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-2">
          Get Sforza
        </a>
      </span>
    </div>
  )
}
