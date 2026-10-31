import { create } from 'zustand'
import { produce } from 'immer'
import { toast } from 'sonner'
import type { AiCheck, Application, BoardColumn, BuiltinStage, Lang, ResumeMeta, Stage } from '@shared/types'
import { baseStage, isSentStage, newColumnId } from '@shared/utils'
import { api } from '@/lib/api'
import { navigate, openCv } from '../router'
import { useEditor } from '../store'

interface ApplicationsState {
  loaded: boolean
  items: Application[]
  /** columns the user added to the board */
  columns: BoardColumn[]
  /** letter to show when a card opens (set by the letter chips on the board) */
  letterFocus: { appId: string; lang: Lang } | null
  /** the letter open on the Letters page, for the top bar's CV and Download buttons */
  letterView: { appId: string; lang: Lang } | null
  load: () => Promise<void>
  create: (fields: Partial<Application>) => Promise<Application>
  /** Local edit, saved shortly after. */
  update: (id: string, fn: (draft: Application) => void) => void
  /** Moves a card to a stage: to the top of the column, to the bottom (`null`) or above another card. */
  move: (id: string, stage: Stage, beforeId?: string | null) => void
  remove: (id: string) => Promise<void>
  replace: (app: Application) => void
  /** After a change made elsewhere (sync.ts): cards and columns, keeping cards with unsaved edits. */
  reload: () => Promise<void>
  flush: () => Promise<void>
  addColumn: (label: string, after: BuiltinStage) => Promise<void>
  renameColumn: (id: BoardColumn['id'], label: string) => Promise<void>
  /** Removes a column; its cards go back to the stage it followed. */
  removeColumn: (id: BoardColumn['id']) => Promise<void>
}

const timers = new Map<string, ReturnType<typeof setTimeout>>()
/** cards whose save is on its way */
const saving = new Set<string>()

export const byOrder = (a: Application, b: Application) => a.order - b.order

export const today = () => new Date().toLocaleDateString('sv-SE')

/** Stage change bookkeeping: history and the date the application was sent. */
function enterStage(d: Application, stage: Stage) {
  if (d.stage === stage) return
  d.stage = stage
  d.history.push({ stage, at: new Date().toISOString() })
  if (isSentStage(stage) && !d.appliedOn) d.appliedOn = today()
}

export const useApplications = create<ApplicationsState>((set, get) => {
  const save = (id: string) => {
    clearTimeout(timers.get(id))
    timers.delete(id)
    const app = get().items.find((a) => a.id === id)
    if (!app) return Promise.resolve()
    saving.add(id)
    return api
      .saveApplication(app)
      .then(() => undefined)
      .catch((err: Error) => {
        toast.error(`Could not save the application: ${err.message}`)
      })
      .finally(() => saving.delete(id))
  }
  const schedule = (id: string) => {
    clearTimeout(timers.get(id))
    timers.set(
      id,
      setTimeout(() => void save(id), 600),
    )
  }

  const saveColumns = async (columns: BoardColumn[]) => {
    const before = get().columns
    set({ columns })
    try {
      set({ columns: await api.saveBoardColumns(columns) })
    } catch (err) {
      set({ columns: before })
      toast.error(`Could not save the columns: ${(err as Error).message}`)
    }
  }

  return {
    loaded: false,
    items: [],
    columns: [],
    letterFocus: null,
    letterView: null,

    load: async () => {
      const [items, columns] = await Promise.all([api.applications(), api.boardColumns().catch(() => [])])
      set({ items, columns, loaded: true })
    },

    create: async (fields) => {
      const app = await api.createApplication(fields)
      set((s) => ({ items: [app, ...s.items] }))
      return app
    },

    update: (id, fn) => {
      set((s) => ({ items: s.items.map((a) => (a.id === id ? produce(a, fn) : a)) }))
      schedule(id)
    },

    move: (id, stage, beforeId) => {
      const column = get()
        .items.filter((a) => a.stage === stage && a.id !== id)
        .sort(byOrder)
      // undefined: top of the column, null: bottom, an id: just above that card
      const at = beforeId === undefined ? 0 : beforeId === null ? -1 : column.findIndex((a) => a.id === beforeId)
      let order: number
      if (!column.length) order = 0
      else if (at < 0) order = column[column.length - 1].order + 1
      else if (at === 0) order = column[0].order - 1
      else order = (column[at - 1].order + column[at].order) / 2
      get().update(id, (d) => {
        enterStage(d, stage)
        d.order = order
      })
    },

    remove: async (id) => {
      clearTimeout(timers.get(id))
      timers.delete(id)
      const { deletedCv } = await api.removeApplication(id)
      set((s) => ({ items: s.items.filter((a) => a.id !== id) }))
      if (deletedCv) useEditor.getState().forget(deletedCv)
    },

    replace: (app) => set((s) => ({ items: s.items.map((a) => (a.id === app.id ? app : a)) })),

    reload: async () => {
      const [items, columns] = await Promise.all([api.applications(), api.boardColumns().catch(() => null)])
      const local = (id: string) => (timers.has(id) || saving.has(id) ? get().items.find((a) => a.id === id) : undefined)
      set((s) => ({ items: items.map((a) => local(a.id) ?? a), columns: columns ?? s.columns }))
    },

    flush: async () => {
      await Promise.all([...timers.keys()].map((id) => save(id)))
    },

    addColumn: async (label, after) => {
      await saveColumns([...get().columns, { id: newColumnId(after), label: label.trim() }])
    },

    renameColumn: async (id, label) => {
      await saveColumns(get().columns.map((c) => (c.id === id ? { ...c, label: label.trim() } : c)))
    },

    removeColumn: async (id) => {
      for (const app of get().items.filter((a) => a.stage === id)) get().move(app.id, baseStage(id), null)
      await get().flush()
      await saveColumns(get().columns.filter((c) => c.id !== id))
    },
  }
})

/** Opens a card with its letter in that language in view. */
export function openLetter(appId: string, lang: Lang) {
  useApplications.setState({ letterFocus: { appId, lang } })
  navigate({ page: 'applications', appId })
}

/** Opens a CV in the editor in the given language. */
export function openCvIn(id: string, lang: Lang | null) {
  if (lang) useEditor.getState().setLang(lang)
  openCv(id, 'content')
}

/** The latest detector result of each document and language, oldest first. */
export function latestAiChecks(app: Pick<Application, 'aiChecks'>): AiCheck[] {
  const latest = new Map<string, AiCheck>()
  for (const c of app.aiChecks ?? []) latest.set(`${c.doc}:${c.lang}`, c)
  return [...latest.values()]
}

/** The board card a CV belongs to (the most recent one if several). */
export function applicationFor(items: Application[], resumeId: string | undefined): Application | undefined {
  if (!resumeId) return undefined
  return items.filter((a) => a.resumeId === resumeId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
}

/** Company logo of a tailored CV: its application's, else the one saved with the CV. */
export function logoFor(items: Application[], meta: Pick<ResumeMeta, 'id' | 'job'> | undefined): string {
  if (!meta) return ''
  return applicationFor(items, meta.id)?.logo || meta.job?.logo || ''
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (e) => {
    if (timers.size) {
      void useApplications.getState().flush()
      e.preventDefault()
    }
  })
}
