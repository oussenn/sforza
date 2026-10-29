import { useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, Columns2, Eye, EyeOff, MoreHorizontal, PencilLine, Trash2 } from 'lucide-react'
import { TEMPLATE_MAP } from '@shared/templates'
import type { ItemSection, Placement, Section, SectionItem } from '@shared/types'
import { newItem } from '@shared/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { sectionTitle } from '@/templates/shared'
import { ConfirmDialog, PromptDialog } from '../dialogs'
import { SECTION_ICON } from '../sectionIcons'
import { moveInArray, reorder, useEditor } from '../store'
import type { ItemType } from './fields'
import { ItemList } from './ItemList'
import { RichTextarea } from './RichTextarea'

export function placementLabels(layout: 'mixed' | 'sidebar' | 'single'): Partial<Record<Placement, string>> {
  if (layout === 'mixed') return { main: 'Left column', side: 'Right column', full: 'Full width' }
  if (layout === 'sidebar') return { side: 'Sidebar', main: 'Main column' }
  return {}
}

function withSection(sections: Section[], id: string, fn: (s: Section) => void) {
  const s = sections.find((x) => x.id === id)
  if (s) fn(s)
}

export default function SectionCard({ section, index, count }: { section: Section; index: number; count: number }) {
  const [open, setOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const lang = useEditor((s) => s.lang)
  const template = useEditor((s) => s.resume!.template)
  const { updateContent, updateAllLangs } = useEditor.getState()
  const Icon = SECTION_ICON[section.type]
  const layout = TEMPLATE_MAP[template].layout
  const placements = placementLabels(layout)

  const moveSection = (delta: number) =>
    updateAllLangs((c) => {
      c.sections = reorder(c.sections, moveInArray(useEditor.getState().resume!.content[lang]!.sections, section.id, delta))
    })

  const setPlacement = (p: Placement) =>
    updateAllLangs((c) =>
      withSection(c.sections, section.id, (s) => {
        s.placement = p
      }),
    )

  const toggleVisible = () =>
    updateAllLangs((c) =>
      withSection(c.sections, section.id, (s) => {
        s.visible = !section.visible
      }),
    )

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="bg-card ring-hairline rounded-2xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] ring-1">
      <div className="flex items-center gap-2 py-1 pr-2 pl-5">
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-3 py-4 text-left">
          <Icon className="text-foreground/90 size-5 shrink-0" />
          <span className={cn('text-foreground truncate text-[15px] font-bold tracking-wide uppercase', !section.visible && 'text-muted-foreground/60')}>
            {sectionTitle(section, lang)}
          </span>
          {!section.visible && (
            <Badge variant="secondary" className="shrink-0">
              Hidden
            </Badge>
          )}
          {layout !== 'single' && placements[section.placement] && (
            <span className="text-muted-foreground hidden shrink-0 text-xs xl:inline">{placements[section.placement]}</span>
          )}
          <ChevronDown className={cn('text-muted-foreground ml-auto size-4 shrink-0 transition-transform', open && 'rotate-180')} />
        </CollapsibleTrigger>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="text-muted-foreground">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onClick={() => setRenaming(true)}>
              <PencilLine /> Rename heading
            </DropdownMenuItem>
            <DropdownMenuItem disabled={index === 0} onClick={() => moveSection(-1)}>
              <ArrowUp /> Move up
            </DropdownMenuItem>
            <DropdownMenuItem disabled={index === count - 1} onClick={() => moveSection(1)}>
              <ArrowDown /> Move down
            </DropdownMenuItem>
            {layout !== 'single' && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Columns2 /> Position
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuLabel className="text-xs">Where this section sits</DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={section.placement} onValueChange={(v) => setPlacement(v as Placement)}>
                    {Object.entries(placements).map(([value, label]) => (
                      <DropdownMenuRadioItem key={value} value={value}>
                        {label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            <DropdownMenuItem onClick={toggleVisible}>
              {section.visible ? <EyeOff /> : <Eye />} {section.visible ? 'Hide section' : 'Show section'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => setDeleting(true)}>
              <Trash2 /> Delete section
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <CollapsibleContent>
        <div className="border-border/60 border-t px-4 pt-4 pb-3">
          {section.type === 'summary' ? (
            <div className="grid gap-3">
              <RichTextarea
                value={section.text}
                minRows={4}
                placeholder="Two or three sentences about who you are and what you bring."
                onChange={(text) =>
                  updateContent((c) =>
                    withSection(c.sections, section.id, (s) => {
                      if (s.type === 'summary') s.text = text
                    }),
                  )
                }
              />
              <label className="text-muted-foreground flex items-center gap-2 text-sm">
                <Switch
                  checked={section.showTitle ?? TEMPLATE_MAP[template].summaryTitle}
                  onCheckedChange={(v) =>
                    updateAllLangs((c) =>
                      withSection(c.sections, section.id, (s) => {
                        if (s.type === 'summary') s.showTitle = v
                      }),
                    )
                  }
                />
                Show heading above the summary
              </label>
            </div>
          ) : (
            <SectionItems section={section} />
          )}
        </div>
      </CollapsibleContent>

      <PromptDialog
        open={renaming}
        onOpenChange={setRenaming}
        title="Rename heading"
        label="Heading shown on the CV"
        initial={sectionTitle(section, lang)}
        onSubmit={(title) =>
          updateContent((c) =>
            withSection(c.sections, section.id, (s) => {
              s.title = title
            }),
          )
        }
      />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete "${sectionTitle(section, lang)}"?`}
        description="The section and all its entries are removed from every language of this CV."
        confirmLabel="Delete"
        destructive
        onConfirm={() =>
          updateAllLangs((c) => {
            c.sections = c.sections.filter((s) => s.id !== section.id)
          })
        }
      />
    </Collapsible>
  )
}

function SectionItems({ section }: { section: ItemSection }) {
  const lang = useEditor((s) => s.lang)
  const { updateContent, updateAllLangs } = useEditor.getState()
  const itemsOf = (s: Section) => (s.type === 'summary' ? [] : (s.items as SectionItem[]))

  return (
    <ItemList
      type={section.type as ItemType}
      items={section.items as SectionItem[]}
      onChange={(id, key, value) =>
        updateContent((c) =>
          withSection(c.sections, section.id, (s) => {
            const item = itemsOf(s).find((i) => i.id === id)
            if (item) (item as unknown as Record<string, unknown>)[key] = value
          }),
        )
      }
      onAdd={() => {
        const item = newItem(section.type as ItemType)
        updateContent((c) =>
          withSection(c.sections, section.id, (s) => {
            itemsOf(s).push(item)
          }),
        )
        return item.id
      }}
      onRemove={(id) =>
        updateAllLangs((c) =>
          withSection(c.sections, section.id, (s) => {
            if (s.type !== 'summary') (s as { items: SectionItem[] }).items = itemsOf(s).filter((i) => i.id !== id)
          }),
        )
      }
      onMove={(id, delta) => {
        const current = useEditor.getState().resume!.content[lang]!.sections.find((s) => s.id === section.id)
        if (!current) return
        const order = moveInArray(itemsOf(current), id, delta)
        updateAllLangs((c) =>
          withSection(c.sections, section.id, (s) => {
            if (s.type !== 'summary') (s as { items: SectionItem[] }).items = reorder(itemsOf(s), order)
          }),
        )
      }}
      onToggleHidden={(id) => {
        const hidden = !section.items.find((i) => i.id === id)?.hidden
        updateAllLangs((c) =>
          withSection(c.sections, section.id, (s) => {
            const item = itemsOf(s).find((i) => i.id === id)
            if (item) item.hidden = hidden
          }),
        )
      }}
    />
  )
}
