import { useSyncExternalStore } from 'react'

/** Whether a media query matches, kept up to date. */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const m = window.matchMedia(query)
      m.addEventListener('change', onChange)
      return () => m.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
  )
}

/** The wide layout (Tailwind lg): the page sits beside its editor instead of in the bottom sheet. */
export const useWide = () => useMedia('(min-width: 1024px)')
