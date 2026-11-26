import { Bot, Library, Search, Sparkles } from 'lucide-react'
import type { PanelPage } from '../router'

/** The pages about you, for the top bar, the command palette and page titles (the pages load on first visit). */
export const PANELS = {
  jobsearch: { icon: Search, label: 'Job search', heading: 'Job search' },
  knowledge: { icon: Library, label: 'Knowledge base', heading: 'Knowledge base' },
  mcp: { icon: Bot, label: 'MCP', heading: 'Connect your agent' },
  ai: { icon: Sparkles, label: 'AI', heading: 'AI models' },
} satisfies Record<PanelPage, { icon: typeof Search; label: string; heading: string }>
