import { useEffect, useMemo, useState } from 'react'
import { knowledgeScore, type KbScore } from '@shared/kbscore'
import type { ResumeContent } from '@shared/types'
import { api } from '@/lib/api'
import { useEditor } from '../store'

/** The master CV's text by its last save, fetched once per change and shared by every user of the hook. */
let cached: { id: string; updatedAt: string; content: ResumeContent | null } | null = null
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()

/**
 * The knowledge score (shared/kbscore.ts) of this account: its master CV and its knowledge base together. It follows
 * edits as they are typed: the knowledge base is in the store, and so is the master CV while it is open.
 */
export function useKnowledgeScore(): KbScore | null {
  const library = useEditor((s) => s.library)
  const master = useEditor((s) => s.list.find((m) => m.kind === 'master'))
  const open = useEditor((s) => (s.resume && s.resume.kind === 'master' ? s.resume : null))
  const [, rerender] = useState(0)

  useEffect(() => {
    const l = () => rerender((n) => n + 1)
    listeners.add(l)
    return () => void listeners.delete(l)
  }, [])

  useEffect(() => {
    if (!master || open?.id === master.id) return
    if (cached?.id === master.id && cached.updatedAt === master.updatedAt) return
    loading ??= api
      .get(master.id)
      .then((r) => {
        cached = { id: r.id, updatedAt: master.updatedAt, content: r.content[r.sourceLang] ?? null }
      })
      .catch(() => undefined)
      .finally(() => {
        loading = null
        listeners.forEach((l) => l())
      })
  }, [master?.id, master?.updatedAt, open?.id])

  const content = open && open.id === master?.id ? (open.content[open.sourceLang] ?? null) : cached?.id === master?.id ? (cached?.content ?? null) : null
  const known = !!library && (!!content || !master)
  return useMemo(() => (known ? knowledgeScore(content, library) : null), [known, content, library])
}
