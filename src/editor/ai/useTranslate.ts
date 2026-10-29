import { useState } from 'react'
import { toast } from 'sonner'
import { LANG_LABELS, type Lang } from '@shared/types'
import { api } from '@/lib/api'
import { useEditor } from '../store'

/** Runs an AI translation of the current CV's source language into `targets`. */
export function useTranslate() {
  const [progress, setProgress] = useState<string | null>(null)

  const run = async (targets: Lang[]) => {
    const { resume, flush, replace } = useEditor.getState()
    if (!resume || !targets.length) return
    await flush()
    setProgress('Starting…')
    try {
      const updated = await api.translate({ id: resume.id, targets }, setProgress)
      replace(updated)
      toast.success(`Translated to ${targets.map((l) => LANG_LABELS[l].name).join(' & ')}`)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setProgress(null)
      void useEditor.getState().refreshAi()
    }
  }

  return { progress, busy: progress !== null, run }
}
