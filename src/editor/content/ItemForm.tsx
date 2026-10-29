import { useId } from 'react'
import type { SectionItem } from '@shared/types'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { FIELDS, type ItemType } from './fields'
import { RichTextarea } from './RichTextarea'

export function Rating({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex h-8 items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          aria-label={`${n} of 5`}
          onClick={() => onChange(value === n ? 0 : n)}
          className={cn(
            'border-foreground/25 size-4 rounded-full border transition-colors',
            n <= value ? 'border-foreground bg-foreground' : 'hover:border-foreground/60',
          )}
        />
      ))}
      <span className="text-muted-foreground ml-2 text-xs">{value ? `${value}/5` : 'none'}</span>
    </div>
  )
}

/** Form for one CV entry, driven by the field definitions in fields.ts. */
export function ItemForm({
  type,
  item,
  onChange,
}: {
  type: ItemType
  item: SectionItem
  onChange: (key: string, value: string | boolean | number) => void
}) {
  const uid = useId()
  const values = item as unknown as Record<string, string | boolean | number>
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-3">
      {FIELDS[type].map((f) => {
        const id = `${uid}-${f.key}`
        const value = values[f.key]
        if (f.kind === 'switch') {
          return (
            <label key={f.key} className="col-span-2 flex items-center gap-2 text-sm">
              <Switch checked={!!value} onCheckedChange={(v) => onChange(f.key, v)} />
              {f.label}
            </label>
          )
        }
        return (
          <div key={f.key} className={cn('grid gap-1.5', f.wide ? 'col-span-2' : 'col-span-2 sm:col-span-1')}>
            <Label htmlFor={id} className="text-muted-foreground text-xs font-medium">
              {f.label}
            </Label>
            {f.kind === 'rich' ? (
              <RichTextarea value={(value as string) ?? ''} onChange={(v) => onChange(f.key, v)} minRows={4} />
            ) : f.kind === 'textarea' ? (
              <Textarea id={id} value={(value as string) ?? ''} placeholder={f.placeholder} rows={2} onChange={(e) => onChange(f.key, e.target.value)} />
            ) : f.kind === 'rating' ? (
              <Rating value={Number(value) || 0} onChange={(v) => onChange(f.key, v)} />
            ) : (
              <Input
                id={id}
                type={f.kind === 'url' ? 'url' : 'text'}
                value={(value as string) ?? ''}
                placeholder={f.placeholder}
                disabled={(f.key === 'end' && !!values.current) || undefined}
                onChange={(e) => onChange(f.key, e.target.value)}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
