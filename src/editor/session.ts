import { create } from 'zustand'

/**
 * What /api/auth/me says about the signed-in account beyond its name: whether it is the admin and how many people
 * wait for access (the badge on the menu), and whether the welcome tour was seen (it shows once per account).
 */
interface Session {
  admin: boolean
  pendingRequests: number
  tourSeen: boolean
  /** the tour is on screen */
  touring: boolean
}

export const useSession = create<Session>(() => ({ admin: false, pendingRequests: 0, tourSeen: true, touring: false }))

export const startTour = () => useSession.setState({ touring: true })
