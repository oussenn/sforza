import type { Library as LibraryData } from '@shared/types'
import { newItem } from '@shared/utils'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { ItemType } from '../content/fields'
import { ItemList } from '../content/ItemList'
import { RichTextarea } from '../content/RichTextarea'
import { moveInArray, reorder, useEditor } from '../store'

type ListKey = 'projects' | 'skills' | 'experience' | 'certifications'

const LIBRARY_TABS: { key: ListKey; type: ItemType; label: string }[] = [
  { key: 'projects', type: 'projects', label: 'Projects' },
  { key: 'skills', type: 'skills', label: 'Skills' },
  { key: 'experience', type: 'experience', label: 'Experience' },
  { key: 'certifications', type: 'certifications', label: 'Certificates' },
]

function LibraryList({ listKey, type }: { listKey: ListKey; type: ItemType }) {
  const items = useEditor((s) => s.library?.[listKey] ?? [])
  const { updateLibrary } = useEditor.getState()
  const listOf = (d: LibraryData) => d[listKey] as unknown as { id: string }[]
  return (
    <ItemList
      type={type}
      items={items}
      onChange={(id, key, value) =>
        updateLibrary((d) => {
          const item = listOf(d).find((i) => i.id === id)
          if (item) (item as Record<string, unknown>)[key] = value
        })
      }
      onAdd={() => {
        const item = newItem(type)
        updateLibrary((d) => {
          listOf(d).push(item)
        })
        return item.id
      }}
      onRemove={(id) =>
        updateLibrary((d) => {
          ;(d as unknown as Record<ListKey, { id: string }[]>)[listKey] = listOf(d).filter((i) => i.id !== id)
        })
      }
      onMove={(id, delta) =>
        updateLibrary((d) => {
          ;(d as unknown as Record<ListKey, { id: string }[]>)[listKey] = reorder(listOf(d), moveInArray(listOf(d), id, delta))
        })
      }
    />
  )
}

/** The library: material beyond the master CV that the CV and letter writers (the site's AI or Claude) pick from. */
export default function KnowledgeBase() {
  const library = useEditor((s) => s.library)
  const { updateLibrary } = useEditor.getState()
  if (!library) return null
  return (
    <Tabs defaultValue="projects">
      {/* Wraps on phones: the bar grows with its rows instead of keeping one row's height. */}
      <TabsList className="mb-4 h-auto! max-w-full flex-wrap justify-start">
        {LIBRARY_TABS.map((t) => (
          <TabsTrigger key={t.key} value={t.key} className="h-7 flex-none">
            {t.label}
            <span className="text-muted-foreground ml-1 text-xs tabular-nums">{library[t.key].length}</span>
          </TabsTrigger>
        ))}
        <TabsTrigger value="notes" className="h-7 flex-none">
          Notes &amp; knowledge
        </TabsTrigger>
      </TabsList>
      {LIBRARY_TABS.map((t) => (
        <TabsContent key={t.key} value={t.key}>
          <LibraryList listKey={t.key} type={t.type} />
        </TabsContent>
      ))}
      <TabsContent value="notes">
        <RichTextarea
          value={library.notes}
          minRows={10}
          onChange={(v) =>
            updateLibrary((d) => {
              d.notes = v
            })
          }
        />
      </TabsContent>
    </Tabs>
  )
}
