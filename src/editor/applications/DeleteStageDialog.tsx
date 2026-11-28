import { useEffect, useState } from 'react'
import type { BuiltinStage, Stage } from '@shared/types'
import { STAGES } from '@shared/types'
import { baseStage, boardStages } from '@shared/utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { stageDot, useStageLabel } from './stages'
import { useApplications } from './store'

/**
 * Deletes a built-in stage (Saved, Draft, Applied, ...) from the board. With columns of its own after it, its cards go
 * there; otherwise the user picks the column that takes them, and cards saved in that stage later (by the user or an
 * agent) land there too. "Add column" brings a deleted stage back.
 */
export default function DeleteStageDialog({ stage, cards, onClose }: { stage: BuiltinStage | null; cards: number; onClose: () => void }) {
  const columns = useApplications((s) => s.columns)
  const hidden = useApplications((s) => s.hidden)
  const deleteStage = useApplications((s) => s.deleteStage)
  const label = useStageLabel()
  const own = stage ? columns.filter((c) => baseStage(c.id) === stage) : []
  // Every other column that stays, the nearest one before this stage first.
  const others = stage ? boardStages(columns, [...hidden, stage]) : []
  const nearest = (() => {
    if (!stage) return null
    const at = STAGES.indexOf(stage)
    const before = others.filter((s) => STAGES.indexOf(baseStage(s)) < at)
    return before[before.length - 1] ?? others[0] ?? null
  })()
  const [to, setTo] = useState<Stage | null>(nearest)
  useEffect(() => setTo(nearest), [stage])

  if (!stage) return null
  const name = label(stage)
  const where = own.length ? own.map((c) => `“${c.label}”`).join(' and ') : null

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete “{name}”?</DialogTitle>
          <DialogDescription>
            {where
              ? `${cards ? `Its ${cards === 1 ? 'card goes' : `${cards} cards go`} to ${where}, and cards` : 'Cards'} saved as ${name} later land there too.`
              : `${cards ? `Its ${cards === 1 ? 'card goes' : `${cards} cards go`} to the column you pick, and cards` : 'Cards'} saved as ${name} later, by you or your agent, land there too.`}{' '}
            No card is deleted. “Add column” brings {name} back.
          </DialogDescription>
        </DialogHeader>
        {!where && (
          <div className="grid gap-1.5">
            <Label className="text-muted-foreground text-xs">Its cards go to</Label>
            <Select value={to ?? undefined} onValueChange={(v) => setTo(v as Stage)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {others.map((s) => (
                  <SelectItem key={s} value={s}>
                    <span className={cn('size-2 rounded-full', stageDot(s))} />
                    {label(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!where && !to}
            onClick={() => {
              onClose()
              void deleteStage(stage, where ? undefined : (to ?? undefined))
            }}
          >
            Delete column
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
