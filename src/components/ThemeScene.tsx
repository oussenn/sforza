import { useEffect, useRef } from 'react'
import { Field, MONO, petalSprites, type Sprite } from '@/lib/fx'
import { useAppearance } from '@/lib/theme'
import { Backdrop } from './Backdrop'

/**
 * What lies behind the app, per theme: the painting (standard), soft pink curves with cherry branches hanging from
 * the top corners and petals falling from them (sakura), a starfield with shooting stars (space), a phosphor grid
 * with a faint glyph rain (terminal), the user's three colours as soft light (custom). Everything here sits under
 * the app and takes no clicks; with motion effects off it stands still.
 */
export function ThemeScene({ blurred, animate }: { blurred: boolean; animate: boolean }) {
  const { look, resolved, motion } = useAppearance()
  if (look === 'standard') return <Backdrop blurred={blurred} animate={animate} />
  const dark = resolved === 'dark'
  return (
    <div aria-hidden className="scene pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {look === 'sakura' && <SakuraScene dark={dark} motion={motion} />}
      {look === 'space' && <AmbientCanvas key={`space-${dark}-${motion}`} kind="space" dark={dark} motion={motion} />}
      {look === 'terminal' && <AmbientCanvas key={`terminal-${dark}-${motion}`} kind="terminal" dark={dark} motion={motion} />}
    </div>
  )
}

/** The big soft curves of a pink tablet home screen, under the branches. */
function SakuraCurves() {
  return (
    <svg className="absolute inset-0 size-full" viewBox="0 0 1600 1000" preserveAspectRatio="none">
      <path d="M560 0 C 380 260, 420 640, 760 1000 L 1600 1000 L 1600 0 Z" fill="var(--sakura-curve-1)" />
      <path d="M1080 0 C 900 300, 980 700, 1300 1000 L 1600 1000 L 1600 0 Z" fill="var(--sakura-curve-2)" />
    </svg>
  )
}

function SakuraScene({ dark, motion }: { dark: boolean; motion: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const right = useRef<HTMLImageElement>(null)
  const left = useRef<HTMLImageElement>(null)

  useEffect(() => {
    if (!motion || !canvas.current) return
    const field = new Field(canvas.current)
    field.breeze = 16
    let alive = true
    let next = 0.4
    let gustIn = 8 + Math.random() * 8
    // Where petals leave the branches: the flowered middle of each branch picture.
    const from = (img: HTMLImageElement | null, mirrored: boolean) => {
      if (!img || !img.offsetParent) return null
      const r = img.getBoundingClientRect()
      const x0 = mirrored ? r.left + r.width * 0.2 : r.left + r.width * 0.12
      const x1 = mirrored ? r.right - r.width * 0.12 : r.right - r.width * 0.2
      return { x: x0 + Math.random() * Math.max(10, x1 - x0), y: r.top + r.height * (0.2 + Math.random() * 0.55) }
    }
    const drop = (n = 1) => {
      for (let i = 0; i < n; i++) {
        const useLeft = Math.random() < 0.38
        const p = (useLeft ? from(left.current, true) : null) ?? from(right.current, false)
        if (p) field.add({ x: p.x, y: p.y, vx: -10 + Math.random() * 20, vy: 8, size: 11 + Math.random() * 12, alpha: dark ? 0.78 : 0.92 })
      }
    }
    field.ambient = (dt) => {
      next -= dt
      gustIn -= dt
      // About one petal a second on a wide window, fewer on a phone.
      if (next <= 0) {
        drop()
        next = (0.7 + Math.random() * 0.9) * Math.max(1, 1200 / Math.max(600, field.width))
      }
      if (gustIn <= 0) {
        field.gust()
        drop(6 + Math.floor(Math.random() * 7))
        gustIn = 10 + Math.random() * 10
      }
    }
    void petalSprites().then((s) => {
      if (!alive) return
      field.sprites = s
      drop(3)
      field.resume()
    })
    const move = (e: PointerEvent) => field.movePointer(e.clientX, e.clientY)
    const resize = () => field.resize()
    const vis = () => !document.hidden && field.resume()
    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('resize', resize)
    document.addEventListener('visibilitychange', vis)
    return () => {
      alive = false
      field.stop()
      window.removeEventListener('pointermove', move)
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', vis)
    }
  }, [motion, dark])

  const src = dark ? '/themes/sakura/branch-night.webp' : '/themes/sakura/branch-day.webp'
  return (
    <>
      <SakuraCurves />
      {dark && <div className="sakura-moon absolute" />}
      <img ref={right} src={src} alt="" className="sakura-branch sakura-branch-right absolute" decoding="async" />
      <img ref={left} src={src} alt="" className="sakura-branch sakura-branch-left absolute max-md:hidden" decoding="async" />
      <canvas ref={canvas} className="absolute inset-0" />
    </>
  )
}

interface Star {
  x: number
  y: number
  r: number
  depth: number
  phase: number
  speed: number
}

/** Stars for a window this size: about one per 5000 px², in three depths (near ones bigger and brighter). */
function makeStars(w: number, h: number, dark: boolean): Star[] {
  const n = Math.round(((w * h) / 5000) * (dark ? 1 : 0.45))
  return Array.from({ length: Math.min(n, 520) }, () => {
    const depth = Math.random() < 0.7 ? 0.3 : Math.random() < 0.7 ? 0.65 : 1
    return { x: Math.random() * w, y: Math.random() * h, r: (0.4 + Math.random() * 0.9) * (0.6 + depth), depth, phase: Math.random() * 6.3, speed: 0.6 + Math.random() * 2.2 }
  })
}

function AmbientCanvas({ kind, dark, motion }: { kind: 'space' | 'terminal'; dark: boolean; motion: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!canvas.current) return
    const field = new Field(canvas.current)
    if (kind === 'space') {
      let stars = makeStars(field.width, field.height, dark)
      let size = `${field.width}x${field.height}`
      const meteors: { x: number; y: number; vx: number; vy: number; age: number }[] = []
      let meteorIn = 3 + Math.random() * 5
      let lastT = 0
      const starColor = dark ? '235 238 255' : '92 96 170'
      field.scene = (ctx, w, h, t, pointer) => {
        if (`${w}x${h}` !== size) {
          stars = makeStars(w, h, dark)
          size = `${w}x${h}`
        }
        const dt = Math.min(0.05, t - lastT)
        lastT = t
        // Parallax: near stars move more with the pointer.
        const px = pointer.x > -1e3 ? (pointer.x / w - 0.5) * 18 : 0
        const py = pointer.y > -1e3 ? (pointer.y / h - 0.5) * 12 : 0
        for (const s of stars) {
          const tw = motion ? 0.55 + 0.45 * Math.sin(t * s.speed + s.phase) : 0.8
          ctx.globalAlpha = (dark ? 0.35 + 0.65 * s.depth : 0.18 + 0.3 * s.depth) * tw
          ctx.fillStyle = `rgb(${starColor})`
          ctx.beginPath()
          ctx.arc(s.x - px * s.depth, s.y - py * s.depth, s.r, 0, Math.PI * 2)
          ctx.fill()
        }
        if (!motion) return
        meteorIn -= dt
        if (meteorIn <= 0) {
          const fromLeft = Math.random() < 0.5
          meteors.push({ x: fromLeft ? Math.random() * w * 0.5 : w * (0.5 + Math.random() * 0.5), y: Math.random() * h * 0.35, vx: (fromLeft ? 1 : -1) * (700 + Math.random() * 400), vy: 260 + Math.random() * 200, age: 0 })
          meteorIn = 5 + Math.random() * 9
        }
        for (let i = meteors.length - 1; i >= 0; i--) {
          const m = meteors[i]
          m.age += dt
          m.x += m.vx * dt
          m.y += m.vy * dt
          const life = 1 - m.age / 0.9
          if (life <= 0) {
            meteors.splice(i, 1)
            continue
          }
          const len = 0.16
          const g = ctx.createLinearGradient(m.x, m.y, m.x - m.vx * len, m.y - m.vy * len)
          g.addColorStop(0, `rgb(${starColor} / ${0.9 * life})`)
          g.addColorStop(1, `rgb(${starColor} / 0)`)
          ctx.globalAlpha = 1
          ctx.strokeStyle = g
          ctx.lineWidth = 1.6
          ctx.beginPath()
          ctx.moveTo(m.x, m.y)
          ctx.lineTo(m.x - m.vx * len, m.y - m.vy * len)
          ctx.stroke()
        }
        ctx.globalAlpha = 1
      }
    } else {
      // Terminal: now and then a short column of glyphs drifts down the background.
      const glyph: Sprite = { kind: 'glyph', chars: '01<>/\\{}[]#$%&*+=:;~', color: dark ? 'rgb(57 255 122)' : 'rgb(20 100 45)', font: MONO }
      field.sprites = [glyph]
      let next = 0
      field.ambient = (dt, f) => {
        next -= dt
        if (next > 0) return
        next = 0.5 + Math.random() * 0.9
        const x = Math.round((Math.random() * f.width) / 18) * 18
        const vy = 35 + Math.random() * 60
        const n = 6 + Math.floor(Math.random() * 8)
        const base = dark ? 0.16 : 0.09
        for (let i = 0; i < n; i++) f.add({ x, y: -i * 17, vx: 0, vy, size: 13, mode: 'rain', life: (f.height + n * 17) / vy + 1, alpha: base * (1 - i / n) })
      }
    }
    const move = (e: PointerEvent) => field.movePointer(e.clientX, e.clientY)
    const vis = () => !document.hidden && field.resume()
    const paint = field.scene
    const once: typeof paint = (...a) => {
      paint?.(...a)
      field.scene = undefined
    }
    const resize = () => {
      if (!motion) field.scene = once
      field.resize()
    }
    if (motion) {
      window.addEventListener('pointermove', move, { passive: true })
      document.addEventListener('visibilitychange', vis)
    } else {
      // Standing still: one frame, no loop.
      field.ambient = undefined
      field.scene = once
    }
    window.addEventListener('resize', resize)
    return () => {
      field.stop()
      window.removeEventListener('pointermove', move)
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', vis)
    }
  }, [kind, dark, motion])
  return <canvas ref={canvas} className="absolute inset-0" />
}
