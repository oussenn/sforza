import { useState, type ReactNode } from 'react'
import { Info } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/**
 * Small "i" next to a title; the explanation shows on hover or keyboard focus, and on tap on touch screens (they
 * have no hover). The trigger's handlers keep Radix from closing it on the same tap that opens it.
 */
export function InfoTip({ children, label = 'More information', className }: { children: ReactNode; label?: string; className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onPointerDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.preventDefault()
            setOpen((o) => !o)
          }}
          className={cn('text-muted-foreground/70 hover:text-foreground inline-grid size-4 shrink-0 place-items-center rounded-full', className)}
        >
          <Info className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-72 leading-relaxed">
        {children}
      </TooltipContent>
    </Tooltip>
  )
}
