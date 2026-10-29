import { useState } from 'react'
import { cn } from '@/lib/utils'

function initials(name: string): string {
  const words = name
    .replace(/\b(gmbh|ag|se|sa|sas|sarl|ltd|inc|llc|co|kg|group|groupe)\b\.?/gi, '')
    .split(/[\s&+\-/.,]+/)
    .filter(Boolean)
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2)).toUpperCase()
}

/** Company logo on a white tile (logos are drawn for light backgrounds), or the company's initials. */
export function CompanyLogo({ src, name, size = 40, className }: { src?: string; name: string; size?: number; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null)
  const radius = Math.round(size * 0.24)
  if (src && failed !== src) {
    return (
      <span
        className={cn('grid shrink-0 place-items-center overflow-hidden bg-white ring-1 ring-hairline', className)}
        style={{ width: size, height: size, borderRadius: radius, padding: Math.max(2, Math.round(size * 0.08)) }}
      >
        <img src={src} alt="" loading="lazy" onError={() => setFailed(src)} className="size-full object-contain" />
      </span>
    )
  }
  return (
    <span
      aria-hidden
      className={cn('bg-muted text-muted-foreground grid shrink-0 place-items-center font-semibold tracking-tight', className)}
      style={{ width: size, height: size, borderRadius: radius, fontSize: Math.max(9, size * 0.36) }}
    >
      {initials(name || '?')}
    </span>
  )
}
