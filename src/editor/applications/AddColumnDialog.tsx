import { useEffect, useState, type FormEvent } from 'react'
import type { BuiltinStage } from '@shared/types'
import { STAGE_LABELS, STAGES } from '@shared/types'
import { InfoTip } from '@/components/InfoTip'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { stageDot } from './stages'
import { useApplications } from './store'

/** Adds a column to the board, placed after one of the built-in stages. */
export default function AddColumnDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const addColumn = useApplications((s) => s.addColumn)
  const [label, setLabel] = useState('')
  const [after, setAfter] = useState<BuiltinStage>('applied')

  useEffect(() => {
    if (open) {
      setLabel('')
      setAfter('applied')
    }
  }, [open])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!label.trim()) return
    onOpenChange(false)
    await addColumn(label, after)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={(e) => void submit(e)} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Add a column</DialogTitle>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="column-name" className="text-muted-foreground text-xs">
              Name
            </Label>
            <Input id="column-name" autoFocus maxLength={40} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Phone screen" />
          </div>
          <div className="grid gap-1.5">
            <div className="flex items-center gap-1">
              <Label className="text-muted-foreground text-xs">Place after</Label>
              <InfoTip label="About the column position">
                The column sits right after this stage and counts as it: after Saved or Draft a card is not sent yet, after Applied it is.
              </InfoTip>
            </div>
            <Select value={after} onValueChange={(v) => setAfter(v as BuiltinStage)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {STAGES.map((s) => (
                  <SelectItem key={s} value={s}>
                    <span className={cn('size-2 rounded-full', stageDot(s))} />
                    {STAGE_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!label.trim()}>
              Add column
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
