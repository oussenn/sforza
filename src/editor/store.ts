import { create } from 'zustand'
import { produce } from 'immer'
import { toast } from 'sonner'
import type { AiStatus, Lang, Library, Resume, ResumeContent, ResumeMeta, SearchProfile, Section } from '@shared/types'
import { LANGS } from '@shared/types'
import { toMeta } from '@shared/utils'
import { api } from '@/lib/api'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

interface EditorState {
  ready: boolean
  list: ResumeMeta[]
  resume: Resume | null
  lang: Lang
  saveState: SaveState
  library: Library | null
  searchProfile: SearchProfile | null
  ai: AiStatus | null
  tailorDraft: TailorDraft | null

  init: () => Promise<void>
  open: (id: string) => Promise<void>
  setLang: (lang: Lang) => void
  /** Mutate the whole resume (style, template, photo, name…). */
  update: (fn: (draft: Resume) => void) => void
  /** Mutate the content of the language being edited. */
  updateContent: (fn: (draft: ResumeContent) => void) => void
  /** Structural change applied to every language (matching sections/items by id). */
  updateAllLangs: (fn: (draft: ResumeContent, lang: Lang) => void) => void
  flush: () => Promise<void>
  refreshList: () => Promise<void>
  replace: (resume: Resume) => void
  duplicate: (id: string, name?: string) => Promise<Resume>
  remove: (id: string) => Promise<void>
  setMain: (id: string) => Promise<void>
  updateLibrary: (fn: (draft: Library) => void) => void
  updateSearchProfile: (fn: (draft: SearchProfile) => void) => void
  /** Reloads the AI provider status and what was spent. */
  refreshAi: () => Promise<void>
}

let saveTimer: ReturnType<typeof setTimeout> | undefined
let libraryTimer: ReturnType<typeof setTimeout> | undefined
let profileTimer: ReturnType<typeof setTimeout> | undefined
let version = 0
let savedVersion = 0
let inflight: Promise<void> | null = null
let opening = 0

/** A job to prefill in "Tailor to a job", e.g. from an application card. */
export interface TailorDraft {
  applicationId: string | null
  title: string
  company: string
  url: string
  description: string
  location: string
  logo: string
}

export const useEditor = create<EditorState>((set, get) => {
  const scheduleSave = () => {
    version++
    set({ saveState: 'saving' })
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => void get().flush(), 700)
  }

  return {
    ready: false,
    list: [],
    resume: null,
    lang: 'en',
    saveState: 'idle',
    library: null,
    searchProfile: null,
    ai: null,
    tailorDraft: null,

    // The CV to open comes from the URL (see Editor.tsx).
    init: async () => {
      const [list, library, searchProfile, ai] = await Promise.all([
        api.list(),
        api.library(),
        api.searchProfile().catch(() => null),
        api.aiStatus().catch(() => null),
      ])
      set({ list, library, searchProfile, ai, ready: true })
    },

    open: async (id) => {
      const ticket = ++opening
      await get().flush()
      const resume = await api.get(id)
      // A later open() won the race.
      if (ticket !== opening) return
      const lang = resume.content[get().lang] ? get().lang : resume.sourceLang
      set({ resume, lang, saveState: 'idle' })
    },

    setLang: (lang) => set({ lang }),

    update: (fn) => {
      const { resume } = get()
      if (!resume) return
      set({ resume: produce(resume, fn) })
      scheduleSave()
    },

    updateContent: (fn) => {
      const { resume, lang } = get()
      if (!resume?.content[lang]) return
      set({
        resume: produce(resume, (d) => {
          fn(d.content[lang]!)
        }),
      })
      scheduleSave()
    },

    updateAllLangs: (fn) => {
      const { resume } = get()
      if (!resume) return
      set({
        resume: produce(resume, (d) => {
          for (const l of LANGS) {
            const c = d.content[l]
            if (c) fn(c, l)
          }
        }),
      })
      scheduleSave()
    },

    flush: async () => {
      clearTimeout(saveTimer)
      if (inflight) await inflight
      const { resume } = get()
      if (!resume || version === savedVersion) return
      const target = version
      let failed = false
      inflight = (async () => {
        try {
          const { updatedAt } = await api.save(resume)
          savedVersion = target
          set((s) => ({
            saveState: version === savedVersion ? 'saved' : s.saveState,
            list: s.list.map((m) => (m.id === resume.id ? { ...toMeta(resume), updatedAt, isMain: m.isMain } : m)),
          }))
        } catch (err) {
          failed = true
          set({ saveState: 'error' })
          toast.error(`Could not save: ${(err as Error).message}`)
        } finally {
          inflight = null
        }
      })()
      await inflight
      if (!failed && version !== savedVersion) await get().flush()
    },

    refreshList: async () => {
      set({ list: await api.list() })
    },

    replace: (resume) => {
      version = savedVersion
      set((s) => ({
        resume,
        lang: resume.content[s.lang] ? s.lang : resume.sourceLang,
        list: s.list.some((m) => m.id === resume.id)
          ? s.list.map((m) => (m.id === resume.id ? toMeta(resume) : m))
          : [...s.list, toMeta(resume)],
      }))
    },

    duplicate: async (id, name) => {
      await get().flush()
      const copy = await api.create({ duplicateOf: id, name })
      await get().refreshList()
      return copy
    },

    remove: async (id) => {
      await api.remove(id)
      if (get().resume?.id === id) {
        // Drop unsaved edits of the deleted CV instead of saving them into a 404.
        clearTimeout(saveTimer)
        version = savedVersion
      }
      set((s) => ({ list: s.list.filter((m) => m.id !== id), resume: s.resume?.id === id ? null : s.resume, saveState: 'idle' }))
    },

    setMain: async (id) => {
      await get().flush()
      await api.setMain(id)
      set((s) => ({
        list: s.list.map((m) => ({ ...m, isMain: m.id === id })),
        resume: s.resume ? { ...s.resume, isMain: s.resume.id === id } : s.resume,
      }))
    },

    refreshAi: async () => {
      const ai = await api.aiStatus().catch(() => null)
      if (ai) set({ ai })
    },

    updateLibrary: (fn) => {
      const { library } = get()
      if (!library) return
      const next = produce(library, fn)
      set({ library: next })
      clearTimeout(libraryTimer)
      libraryTimer = setTimeout(() => {
        api.saveLibrary(get().library!).catch((err: Error) => toast.error(`Could not save library: ${err.message}`))
      }, 700)
    },

    updateSearchProfile: (fn) => {
      const { searchProfile } = get()
      if (!searchProfile) return
      set({ searchProfile: produce(searchProfile, fn) })
      clearTimeout(profileTimer)
      profileTimer = setTimeout(() => {
        api.saveSearchProfile(get().searchProfile!).catch((err: Error) => toast.error(`Could not save the search profile: ${err.message}`))
      }, 700)
    },
  }
})

/* ------------------------------ selectors ------------------------------ */

export function useContent(): ResumeContent | undefined {
  return useEditor((s) => s.resume?.content[s.lang])
}

/** Reorder `sections` to follow `order` (ids not in `order` keep their relative position at the end). */
export function reorder<T extends { id: string }>(items: T[], order: string[]): T[] {
  const index = new Map(order.map((id, i) => [id, i]))
  return [...items].sort((a, b) => (index.get(a.id) ?? Infinity) - (index.get(b.id) ?? Infinity))
}

export function moveInArray<T extends { id: string }>(items: T[], id: string, delta: number): string[] {
  const ids = items.map((i) => i.id)
  const from = ids.indexOf(id)
  const to = from + delta
  if (from < 0 || to < 0 || to >= ids.length) return ids
  ids.splice(to, 0, ids.splice(from, 1)[0])
  return ids
}

export function findSection(content: ResumeContent, id: string): Section | undefined {
  return content.sections.find((s) => s.id === id)
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (e) => {
    if (version !== savedVersion) {
      void useEditor.getState().flush()
      e.preventDefault()
    }
  })
}
