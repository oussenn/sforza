import { useEffect, useState, useSyncExternalStore } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { normalHex, type Palette } from '@/lib/palette'
import { logoFor, LOOKS, setEffects, setLook, setPalette, setSounds, setTheme, useAppearance, warmSounds, type Look, type ThemeChoice } from '@/lib/theme'
import { cn } from '@/lib/utils'

/** Opens from the top bar menu and the command palette. */
let open = false
const listeners = new Set<() => void>()
export function openAppearance() {
  open = true
  listeners.forEach((l) => l())
}
const close = () => {
  open = false
  listeners.forEach((l) => l())
}
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** Each theme's name, what it brings, and the colours of its little preview in light and dark. */
export const LOOK_INFO: Record<Look, { name: string; about: string; light: [string, string, string]; dark: [string, string, string] }> = {
  standard: { name: 'Standard', about: 'The painting and plain greys', light: ['#f1f0ec', '#ffffff', '#262626'], dark: ['#1c1c1c', '#2b2b2b', '#e5e5e5'] },
  sakura: { name: 'Sakura', about: 'Cherry branches, falling petals, blossoms on the buttons', light: ['#f6d4db', '#ffffff', '#d45f7f'], dark: ['#22111b', '#28161f', '#f4a6ba'] },
  terminal: { name: 'Terminal', about: 'Phosphor green, monospace type, scanlines and glyphs', light: ['#e6efe0', '#f8fcf5', '#157a36'], dark: ['#050a06', '#08110a', '#39ff7a'] },
  space: { name: 'Space', about: 'A starfield with shooting stars and nebulae', light: ['#e9ecff', '#ffffff', '#5b4bdb'], dark: ['#070b22', '#0e1330', '#a193ff'] },
  custom: { name: 'Your colours', about: 'Three colours of your own, in light and dark', light: ['', '', ''], dark: ['', '', ''] },
}

const CONTRASTS: { id: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'system', label: 'System', icon: Monitor },
]

const center = (el: HTMLElement) => {
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

export function AppearanceDialog() {
  const isOpen = useSyncExternalStore(subscribe, () => open)
  const { theme, resolved, look, palette, effects, sounds } = useAppearance()
  useEffect(() => {
    if (isOpen) warmSounds()
  }, [isOpen])
  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[88dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Appearance</DialogTitle>
          <DialogDescription>A theme and its contrast, kept with your account on every device. Every theme comes in light and dark.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          <Label>Contrast</Label>
          <ToggleGroup type="single" variant="outline" value={theme} onValueChange={(v) => v && setTheme(v as ThemeChoice)} className="w-full">
            {CONTRASTS.map(({ id, label, icon: Icon }) => (
              <ToggleGroupItem key={id} value={id} className="flex-1 gap-1.5">
                <Icon className="size-4" /> {label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        <div className="grid gap-2">
          <Label>Theme</Label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Theme">
            {LOOKS.map((id) => (
              <LookCard key={id} id={id} active={look === id} dark={resolved === 'dark'} palette={palette} />
            ))}
          </div>
        </div>

        {look === 'custom' && <PaletteEditor palette={palette} />}

        <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
          <div className="grid gap-0.5">
            <Label htmlFor="fx">Motion effects</Label>
            <p className="text-muted-foreground text-xs">
              Falling petals, stars and glyphs, and bursts when you click or move a card. Off by itself when your system asks for reduced motion.
            </p>
          </div>
          <Switch id="fx" checked={effects} onCheckedChange={setEffects} />
        </div>

        <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
          <div className="grid gap-0.5">
            <Label htmlFor="sfx">Theme sounds</Label>
            <p className="text-muted-foreground text-xs">A short sound as Sakura, Terminal or Space spreads over the page. Only when you change the theme.</p>
          </div>
          <Switch id="sfx" checked={sounds} onCheckedChange={setSounds} />
        </div>
      </DialogContent>
    </Dialog>
  )
}

function LookCard({ id, active, dark, palette }: { id: Look; active: boolean; dark: boolean; palette: Palette }) {
  const info = LOOK_INFO[id]
  const [bg, surface, primary] = id === 'custom' ? [palette.base, '#ffffff', palette.primary] : info[dark ? 'dark' : 'light']
  const swatches = id === 'custom' ? [palette.base, palette.primary, palette.accent] : [bg, surface, primary]
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      data-no-fx
      onClick={(e) => setLook(id, center(e.currentTarget))}
      className={cn(
        'hover:border-foreground/30 focus-visible:ring-ring flex flex-col gap-2 rounded-lg border p-2 text-left transition outline-none focus-visible:ring-2',
        active && 'border-primary ring-primary/30 ring-2',
      )}
    >
      <span
        aria-hidden
        className="relative h-16 overflow-hidden rounded-md"
        style={{ background: id === 'custom' ? `linear-gradient(135deg, ${palette.base}, ${palette.accent}66)` : bg }}
      >
        {id === 'sakura' && <img src="/themes/sakura/sprig-3.webp" alt="" className="absolute -top-1 -right-1 h-12" />}
        {id === 'space' && (
          <span className="absolute inset-0" style={{ backgroundImage: `radial-gradient(${dark ? '#fff' : '#6b5be0'} 0.8px, transparent 1px)`, backgroundSize: '11px 13px', opacity: 0.6 }} />
        )}
        {id === 'terminal' && (
          <span className="absolute top-2.5 left-10 font-mono text-[10px]" style={{ color: primary }}>
            {'>'} sforza_
          </span>
        )}
        {id === 'standard' && <img src="/background.webp" alt="" className="absolute inset-0 size-full object-cover opacity-60" />}
        <img src={logoFor(id)} alt="" className="absolute top-0.5 left-1.5 size-8" />
        <span className="absolute right-2 bottom-2 left-2 h-6 rounded-[5px] shadow-sm" style={{ background: surface }}>
          <span className="absolute top-1.5 left-1.5 h-3 w-8 rounded-full" style={{ background: primary }} />
        </span>
      </span>
      <span className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{info.name}</span>
        <span className="flex -space-x-1">
          {swatches.map((c, i) => (
            <span key={i} className="ring-background size-3.5 rounded-full ring-2" style={{ background: c }} />
          ))}
        </span>
      </span>
      <span className="text-muted-foreground text-xs leading-snug">{info.about}</span>
    </button>
  )
}

const FIELDS: { key: keyof Palette; label: string; hint: string }[] = [
  { key: 'base', label: 'Page', hint: 'surfaces and background' },
  { key: 'primary', label: 'Primary', hint: 'buttons and links' },
  { key: 'accent', label: 'Accent', hint: 'highlights' },
]

function PaletteEditor({ palette }: { palette: Palette }) {
  const [draft, setDraft] = useState<Record<keyof Palette, string>>(palette)
  const set = (key: keyof Palette, value: string) => {
    setDraft((d) => ({ ...d, [key]: value }))
    const hex = normalHex(value)
    if (hex) setPalette({ ...palette, [key]: hex })
  }
  return (
    <div className="grid gap-2">
      <Label>Your three colours</Label>
      <div className="grid gap-2 sm:grid-cols-3">
        {FIELDS.map(({ key, label, hint }) => (
          <div key={key} className="flex items-center gap-2 rounded-lg border p-2">
            <input
              type="color"
              aria-label={label}
              value={normalHex(draft[key]) ?? palette[key]}
              onChange={(e) => set(key, e.target.value)}
              className="size-9 shrink-0 cursor-pointer rounded-md border-0 bg-transparent p-0"
            />
            <div className="grid min-w-0 gap-0.5">
              <span className="text-xs font-medium">
                {label} <span className="text-muted-foreground font-normal">· {hint}</span>
              </span>
              <Input value={draft[key]} onChange={(e) => set(key, e.target.value)} spellCheck={false} className="h-7 px-2 font-mono text-xs" aria-label={`${label} colour`} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
