import { useState } from 'react'
import { ChevronDown, ChevronUp, Eye, EyeOff, Plus, Trash2 } from 'lucide-react'
import type { SectionItem } from '@shared/types'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ITEM_NOUN, itemLabels, type ItemType } from './fields'
import { ItemForm } from './ItemForm'

export interface ItemListProps {
  type: ItemType
  items: SectionItem[]
  onChange: (id: string, key: string, value: string | boolean | number) => void
  onAdd: () => string
  onRemove: (id: string) => void
  onMove: (id: string, delta: number) => void
  onToggleHidden?: (id: string) => void
}

/** Collapsible list of entries: click a row to edit it inline. */
export function ItemList({ type, items, onChange, onAdd, onRemove, onMove, onToggleHidden }: ItemListProps) {
  const [openId, setOpenId] = useState<string | null>(null)

  return (
    <div className="flex flex-col gap-2">
      {items.map((item, i) => {
        const { title, subtitle } = itemLabels(type, item)
        const open = openId === item.id
        return (
          <div
            key={item.id}
            className={cn(
              'group bg-card rounded-xl border transition-shadow',
              open && 'ring-border shadow-sm ring-1',
              item.hidden && 'opacity-60',
            )}
          >
            <div className="flex items-center gap-1 py-1 pr-1.5 pl-3">
              <button
                type="button"
                onClick={() => setOpenId(open ? null : item.id)}
                className="flex min-w-0 flex-1 flex-col items-start py-1.5 text-left"
              >
                <span className={cn('w-full truncate text-sm font-semibold', !title && 'text-muted-foreground font-normal italic')}>
                  {title || `Untitled ${ITEM_NOUN[type]}`}
                </span>
                {subtitle && <span className="text-muted-foreground w-full truncate text-xs">{subtitle}</span>}
              </button>
              <div className="flex items-center opacity-100 transition-opacity pointer-fine:opacity-0 pointer-fine:group-focus-within:opacity-100 pointer-fine:group-hover:opacity-100">
                <Button variant="ghost" size="icon-sm" disabled={i === 0} onClick={() => onMove(item.id, -1)} title="Move up">
                  <ChevronUp />
                </Button>
                <Button variant="ghost" size="icon-sm" disabled={i === items.length - 1} onClick={() => onMove(item.id, 1)} title="Move down">
                  <ChevronDown />
                </Button>
                {onToggleHidden && (
                  <Button variant="ghost" size="icon-sm" onClick={() => onToggleHidden(item.id)} title={item.hidden ? 'Show on CV' : 'Hide from CV'}>
                    {item.hidden ? <EyeOff /> : <Eye />}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="hover:text-destructive"
                  onClick={() => onRemove(item.id)}
                  title="Delete"
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
            {open && (
              <div className="border-border/60 border-t px-3 pt-3 pb-4">
                <ItemForm type={type} item={item} onChange={(k, v) => onChange(item.id, k, v)} />
              </div>
            )}
          </div>
        )
      })}
      <Button
        variant="ghost"
        className="text-muted-foreground hover:text-foreground h-9 justify-start gap-2 self-start"
        onClick={() => setOpenId(onAdd())}
      >
        <Plus className="size-4" /> Add {ITEM_NOUN[type]}
      </Button>
    </div>
  )
}
