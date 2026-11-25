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
    const field = new Field(canvas.current, { fps: 40, maxDpr: 1.5 })
    field.breeze = 16
    let alive = true
    let next = 0.8
    let gustIn = 14 + Math.random() * 10
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
      // A petal every two or three seconds on a wide window, fewer on a phone; a small gust now and then.
      if (next <= 0) {
        drop()
        next = (1.8 + Math.random() * 1.6) * Math.max(1, 1200 / Math.max(600, field.width))
      }
      if (gustIn <= 0) {
        field.gust()
        drop(3 + Math.floor(Math.random() * 3))
        gustIn = 16 + Math.random() * 12
      }
    }
    void petalSprites().then((s) => {
      if (!alive) return
      field.sprites = s
      drop(2)
      field.resume()
    })
    const move = (e: PointerEvent) => field.movePointer(e.clientX, e.clientY)
    const resize = debounce(() => field.resize())
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

/** Stars for a window this size: about one per 11000 px², in three depths (near ones bigger and brighter). */
function makeStars(w: number, h: number, dark: boolean): Star[] {
  const n = Math.round(((w * h) / 11000) * (dark ? 1 : 0.5))
  return Array.from({ length: Math.min(n, 220) }, () => {
    const depth = Math.random() < 0.7 ? 0.3 : Math.random() < 0.7 ? 0.65 : 1
    return { x: Math.random() * w, y: Math.random() * h, r: (0.4 + Math.random() * 0.9) * (0.6 + depth), depth, phase: Math.random() * 6.3, speed: 0.6 + Math.random() * 2.2 }
  })
}

/** The steady stars of each depth on its own transparent picture (drawn once per window size). */
function starLayers(stars: Star[], w: number, h: number, dark: boolean) {
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
  const color = dark ? '235 238 255' : '92 96 170'
  return [0.3, 0.65, 1].map((depth) => {
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)
    ctx.fillStyle = `rgb(${color})`
    stars.forEach((s, i) => {
      if (s.depth !== depth || i % 6 === 0) return
      ctx.globalAlpha = (dark ? 0.35 + 0.65 * depth : 0.18 + 0.3 * depth) * 0.8
      ctx.beginPath()
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
      ctx.fill()
    })
    return { canvas, depth }
  })
}

/** Runs `fn` once the window has stopped changing size for a moment. */
function debounce(fn: () => void, ms = 150) {
  let t = 0
  return () => {
    clearTimeout(t)
    t = window.setTimeout(fn, ms)
  }
}

function AmbientCanvas({ kind, dark, motion }: { kind: 'space' | 'terminal'; dark: boolean; motion: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!canvas.current) return
    const field = new Field(canvas.current, { fps: 30, maxDpr: 1.5 })
    if (kind === 'space') {
      let stars = makeStars(field.width, field.height, dark)
      let size = `${field.width}x${field.height}`
      let layers = starLayers(stars, field.width, field.height, dark)
      const meteors: { x: number; y: number; vx: number; vy: number; age: number }[] = []
      let meteorIn = 6 + Math.random() * 6
      let lastT = 0
      const starColor = dark ? '235 238 255' : '92 96 170'
      field.scene = (ctx, w, h, t, pointer) => {
        if (`${w}x${h}` !== size) {
          stars = makeStars(w, h, dark)
          layers = starLayers(stars, w, h, dark)
          size = `${w}x${h}`
        }
        const dt = Math.min(0.05, t - lastT)
        lastT = t
        // Parallax: near stars move more with the pointer. The steady stars are three pictures, drawn once;
        // only every sixth star twinkles on its own.
        const px = pointer.x > -1e3 ? (pointer.x / w - 0.5) * 18 : 0
        const py = pointer.y > -1e3 ? (pointer.y / h - 0.5) * 12 : 0
        ctx.globalAlpha = 1
        for (const l of layers) ctx.drawImage(l.canvas, -px * l.depth, -py * l.depth, w, h)
        ctx.fillStyle = `rgb(${starColor})`
        for (let i = 0; i < stars.length; i += 6) {
          const s = stars[i]
          const tw = motion ? 0.5 + 0.5 * Math.sin(t * s.speed + s.phase) : 0.8
          ctx.globalAlpha = (dark ? 0.35 + 0.65 * s.depth : 0.18 + 0.3 * s.depth) * tw
          ctx.beginPath()
          ctx.arc(s.x - px * s.depth, s.y - py * s.depth, s.r * 1.15, 0, Math.PI * 2)
          ctx.fill()
        }
        if (!motion) return
        meteorIn -= dt
        if (meteorIn <= 0) {
          const fromLeft = Math.random() < 0.5
          meteors.push({ x: fromLeft ? Math.random() * w * 0.5 : w * (0.5 + Math.random() * 0.5), y: Math.random() * h * 0.35, vx: (fromLeft ? 1 : -1) * (700 + Math.random() * 400), vy: 260 + Math.random() * 200, age: 0 })
          meteorIn = 10 + Math.random() * 12
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
        next = 1.3 + Math.random() * 1.3
        const x = Math.round((Math.random() * f.width) / 18) * 18
        const vy = 35 + Math.random() * 60
        const n = 5 + Math.floor(Math.random() * 6)
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
    const resize = debounce(() => {
      if (!motion) field.scene = once
      field.resize()
    })
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
