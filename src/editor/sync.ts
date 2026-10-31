import type { ChangeStamps } from '@shared/types'
import { api } from '@/lib/api'
import { useApplications } from './applications/store'
import { useEditor } from './store'

/**
 * Keeps open pages current when the account changes elsewhere (Claude through the connector, another tab or
 * device). A few bytes of stamps are checked when the page changes, when the window comes back into view and
 * every 30 s while it is visible; only the areas whose stamp moved are reloaded, and the stores keep any edit
 * that is not saved yet.
 */
const EVERY = 30_000

let last: ChangeStamps | null = null
let running: Promise<void> | null = null

export function checkForChanges(): Promise<void> {
  if (document.visibilityState !== 'visible') return Promise.resolve()
  running ??= (async () => {
    try {
      const now = await api.changes()
      const before = last
      last = now
      // The first stamps only mark what the page loaded.
      if (!before) return
      const jobs: Promise<void>[] = []
      if (now.resumes !== before.resumes) jobs.push(useEditor.getState().reloadResumes())
      if (now.settings !== before.settings) jobs.push(useEditor.getState().reloadSettings())
      // Board columns are settings too.
      if ((now.applications !== before.applications || now.settings !== before.settings) && useApplications.getState().loaded) {
        jobs.push(useApplications.getState().reload())
      }
      await Promise.all(jobs)
    } catch {
      // Offline or signed out: the next check tries again.
    } finally {
      running = null
    }
  })()
  return running
}

/** Starts the checks; returns the function that stops them. */
export function startSync(): () => void {
  void checkForChanges()
  const timer = setInterval(() => void checkForChanges(), EVERY)
  const onView = () => void checkForChanges()
  window.addEventListener('focus', onView)
  document.addEventListener('visibilitychange', onView)
  return () => {
    clearInterval(timer)
    window.removeEventListener('focus', onView)
    document.removeEventListener('visibilitychange', onView)
    last = null
  }
}
