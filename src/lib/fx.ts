/**
 * A small particle field on a canvas for the themes' motion effects: petals that fall like real ones, sparks
 * (stars, terminal glyphs, dots) that burst and fade, and an optional painter for the scene behind them (the
 * starfield, the glyph rain). One rAF loop per field, paused when the tab is hidden and idle when nothing moves.
 *
 * Petal physics, per petal: gravity against air drag that depends on how flat it lies (cos of its tumble angle):
 * a flat petal catches the air and drifts down slowly, an edge-on one dives. Lift turns tilt into a sideways
 * glide, a flutter swings it from side to side, wind (gusts plus the pointer's own movement) pushes it, and at the
 * bottom of the window it comes to rest, lies flat and fades.
 */

export type Sprite =
  | { kind: 'image'; img: HTMLImageElement; ratio: number }
  | { kind: 'glyph'; chars: string; color: string; font: string }
  | { kind: 'star'; color: string }
  | { kind: 'dot'; color: string }

type Mode = 'fall' | 'spark' | 'rain'

export interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  /** spin in the screen plane */
  rot: number
  vr: number
  /** tumble around the petal's long axis: drawn as a squash of cos(tilt) */
  tilt: number
  vt: number
  size: number
  age: number
  life: number
  sprite: Sprite
  mode: Mode
  phase: number
  alpha: number
  /** glyph shown (rain and glyph sparks) */
  ch?: string
  /** seconds since it came to rest at the bottom */
  rest?: number
}

export interface Spawn {
  x: number
  y: number
  vx?: number
  vy?: number
  size?: number
  life?: number
  mode?: Mode
  alpha?: number
}

const G = 190
const MAX = 420

const rand = (a: number, b: number) => a + Math.random() * (b - a)

export class Field {
  readonly canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private list: Particle[] = []
  private w = 0
  private h = 0
  private dpr = 1
  private raf = 0
  private last = 0
  private time = 0
  sprites: Sprite[] = []
  /** wind in px/s: a base breeze with gusts (gust() adds one) */
  private wind = 0
  private gustLeft = 0
  private gustPower = 0
  breeze = 14
  /** the pointer, for the wind it makes */
  private pointer = { x: -1e4, y: -1e4, vx: 0, vy: 0, t: 0 }
  /** painted under the particles every frame (starfield); keeps the loop running */
  scene?: (ctx: CanvasRenderingContext2D, w: number, h: number, t: number, pointer: { x: number; y: number }) => void
  /** called every frame before the physics, to spawn ambient particles */
  ambient?: (dt: number, field: Field) => void
  /** at most this many particles resting at the bottom */
  maxResting = 36

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
    this.resize()
  }

  get width() {
    return this.w
  }
  get height() {
    return this.h
  }
  get count() {
    return this.list.length
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.w = window.innerWidth
    this.h = window.innerHeight
    this.canvas.width = Math.round(this.w * this.dpr)
    this.canvas.height = Math.round(this.h * this.dpr)
    this.canvas.style.width = `${this.w}px`
    this.canvas.style.height = `${this.h}px`
    this.wake()
  }

  /** The pointer moved: its speed becomes wind for the particles near it. */
  movePointer(x: number, y: number) {
    const now = performance.now()
    const dt = Math.max(0.008, (now - this.pointer.t) / 1000)
    if (dt < 0.25 && this.pointer.x > -1e3) {
      this.pointer.vx = this.pointer.vx * 0.5 + ((x - this.pointer.x) / dt) * 0.5
      this.pointer.vy = this.pointer.vy * 0.5 + ((y - this.pointer.y) / dt) * 0.5
    } else {
      this.pointer.vx = 0
      this.pointer.vy = 0
    }
    this.pointer.x = x
    this.pointer.y = y
    this.pointer.t = now
  }

  gust(power = rand(60, 140), seconds = rand(1.6, 3)) {
    this.gustPower = power * (Math.random() < 0.5 ? -1 : 1)
    this.gustLeft = seconds
  }

  /** One particle with the field's sprites (a random one unless `sprite` is given). */
  add(s: Spawn, sprite?: Sprite) {
    if (this.list.length >= MAX || !this.sprites.length) return
    const sp = sprite ?? this.sprites[Math.floor(Math.random() * this.sprites.length)]
    const mode = s.mode ?? (sp.kind === 'image' ? 'fall' : 'spark')
    this.list.push({
      x: s.x,
      y: s.y,
      vx: s.vx ?? rand(-20, 20),
      vy: s.vy ?? rand(-10, 30),
      rot: rand(0, Math.PI * 2),
      vr: rand(-2.4, 2.4),
      tilt: rand(0, Math.PI * 2),
      vt: rand(1.2, 3.6) * (Math.random() < 0.5 ? -1 : 1),
      size: s.size ?? rand(14, 24),
      age: 0,
      life: s.life ?? (mode === 'fall' ? 60 : rand(0.6, 1.2)),
      sprite: sp,
      mode,
      phase: rand(0, Math.PI * 2),
      alpha: s.alpha ?? 1,
      ch: sp.kind === 'glyph' ? sp.chars[Math.floor(Math.random() * sp.chars.length)] : undefined,
    })
    this.wake()
  }

  /** A burst from (x, y): mostly upwards and outwards, then the particles fall or fade. */
  burst(x: number, y: number, n: number, power = 1, life: [number, number] = [2.4, 4]) {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + rand(-1.25, 1.25)
      const v = rand(140, 360) * power
      this.add({ x: x + rand(-4, 4), y: y + rand(-4, 4), vx: Math.cos(a) * v, vy: Math.sin(a) * v, size: rand(12, 22), life: rand(...life) })
    }
  }

  /** Particles slipping out from behind a rectangle: along its edges, pushed outwards. */
  fromRect(r: { left: number; top: number; width: number; height: number }, n: number, drift = { x: 0, y: 0 }, life: [number, number] = [3, 5]) {
    const per = 2 * (r.width + r.height)
    for (let i = 0; i < n; i++) {
      let d = Math.random() * per
      let x: number, y: number, nx: number, ny: number
      if (d < r.width) [x, y, nx, ny] = [r.left + d, r.top, 0, -1]
      else if ((d -= r.width) < r.height) [x, y, nx, ny] = [r.left + r.width, r.top + d, 1, 0]
      else if ((d -= r.height) < r.width) [x, y, nx, ny] = [r.left + r.width - d, r.top + r.height, 0, 1]
      else [x, y, nx, ny] = [r.left, r.top + r.height - (d - r.width), -1, 0]
      const v = rand(50, 150)
      this.add({ x, y, vx: nx * v + drift.x + rand(-25, 25), vy: ny * v + drift.y - rand(10, 60), size: rand(12, 22), life: rand(...life) })
    }
  }

  clear() {
    this.list = []
  }

  private wake() {
    if (this.raf || document.hidden) return
    this.last = performance.now()
    this.raf = requestAnimationFrame(this.frame)
  }

  stop() {
    cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  /** The loop runs while something moves or a scene or spawner wants frames. */
  private frame = (now: number) => {
    this.raf = 0
    const dt = Math.min(0.05, (now - this.last) / 1000)
    this.last = now
    this.time += dt
    this.ambient?.(dt, this)
    this.step(dt)
    this.draw()
    if (!document.hidden && (this.list.length || this.scene || this.ambient)) this.raf = requestAnimationFrame(this.frame)
  }

  /** Resume after the tab comes back. */
  resume() {
    this.wake()
  }

  private step(dt: number) {
    // Breeze with slow swells, plus a gust now and then.
    this.gustLeft = Math.max(0, this.gustLeft - dt)
    const gust = this.gustLeft > 0 ? this.gustPower * Math.sin(Math.PI * Math.min(1, this.gustLeft / 2.4)) : 0
    this.wind = this.breeze * (0.6 + 0.4 * Math.sin(this.time * 0.37) + 0.25 * Math.sin(this.time * 1.13)) + gust
    const p = this.pointer
    const pointerFresh = performance.now() - p.t < 120
    let resting = 0
    const keep: Particle[] = []
    for (const q of this.list) {
      q.age += dt
      if (q.mode === 'fall') {
        if (q.rest !== undefined) {
          q.rest += dt
          q.vx *= 0.9
          q.x += q.vx * dt
          q.tilt *= 0.9
          q.vr *= 0.85
          q.rot += q.vr * dt
          resting++
        } else {
          const flat = Math.abs(Math.cos(q.tilt))
          const k = 0.55 + 2.6 * flat
          const rvx = q.vx - this.wind
          let ax = -k * 0.8 * rvx + Math.sin(q.phase) * 70 * flat + Math.sin(2 * q.tilt) * 38
          let ay = G - k * q.vy
          if (pointerFresh) {
            const dx = q.x - p.x
            const dy = q.y - p.y
            const d2 = dx * dx + dy * dy
            if (d2 < 150 * 150) {
              const f = 1 - Math.sqrt(d2) / 150
              ax += p.vx * f * 2.2
              ay += p.vy * f * 2.2
              q.vt += f * 0.6 * Math.sign(p.vx || 1)
            }
          }
          q.vx += ax * dt
          q.vy += ay * dt
          q.x += q.vx * dt
          q.y += q.vy * dt
          q.phase += dt * (2.1 + 1.6 * flat)
          q.vt += (Math.sign(q.vt) * 2.4 - q.vt) * 0.15 * dt
          q.tilt += q.vt * dt
          q.vr += (rand(-1, 1) - q.vr * 0.4) * dt
          q.rot += q.vr * dt
          if (q.y > this.h - q.size * 0.3) {
            q.y = this.h - q.size * 0.3
            q.vy = 0
            q.rest = 0
            q.vr *= 0.4
          }
        }
      } else if (q.mode === 'spark') {
        const drag = 2.6
        q.vx -= q.vx * drag * dt
        q.vy += (60 - q.vy * drag) * dt
        q.x += q.vx * dt
        q.y += q.vy * dt
        q.rot += q.vr * dt
      } else {
        q.y += q.vy * dt
      }
      const off = q.x < -80 || q.x > this.w + 80 || q.y > this.h + 60 || q.y < -this.h
      const restedOut = q.rest !== undefined && (q.rest > 6 || resting > this.maxResting)
      if (!off && !restedOut && q.age < q.life + (q.rest !== undefined ? 6 : 0)) keep.push(q)
    }
    this.list = keep
  }

  private draw() {
    const { ctx, dpr } = this
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, this.w, this.h)
    this.scene?.(ctx, this.w, this.h, this.time, this.pointer)
    for (const q of this.list) {
      // Fade in over 0.25 s, out over the last quarter of the life (a resting petal over its last 2 s).
      const fadeIn = Math.min(1, q.age / 0.25)
      const fadeOut =
        q.rest !== undefined ? Math.max(0, Math.min(1, (6 - q.rest) / 2)) : q.mode === 'fall' ? Math.min(1, (q.life - q.age) / Math.min(2, q.life * 0.4)) : Math.max(0, 1 - q.age / q.life)
      const a = q.alpha * fadeIn * Math.max(0, fadeOut)
      if (a <= 0.01) continue
      ctx.globalAlpha = a
      const s = q.sprite
      const c = Math.cos(q.rot)
      const sn = Math.sin(q.rot)
      if (s.kind === 'image') {
        const squash = Math.max(0.12, Math.abs(Math.cos(q.tilt)))
        // rotate, then squash along the petal's own axis: the tumble in 3D
        ctx.setTransform(dpr * c, dpr * sn, -dpr * sn * squash, dpr * c * squash, dpr * q.x, dpr * q.y)
        const w = q.size
        const h = q.size * s.ratio
        if (Math.cos(q.tilt) < 0) ctx.globalAlpha = a * 0.82
        ctx.drawImage(s.img, -w / 2, -h / 2, w, h)
      } else if (s.kind === 'glyph') {
        ctx.setTransform(dpr, 0, 0, dpr, dpr * q.x, dpr * q.y)
        ctx.fillStyle = s.color
        ctx.font = `${Math.round(q.size)}px ${s.font}`
        ctx.fillText(q.ch ?? '0', 0, 0)
      } else if (s.kind === 'star') {
        const r = q.size * 0.42 * (1 - 0.35 * (q.age / q.life))
        ctx.setTransform(dpr * c, dpr * sn, -dpr * sn, dpr * c, dpr * q.x, dpr * q.y)
        ctx.fillStyle = s.color
        ctx.beginPath()
        for (let i = 0; i < 8; i++) {
          const rr = i % 2 ? r * 0.28 : r
          const an = (i * Math.PI) / 4
          ctx.lineTo(Math.cos(an) * rr, Math.sin(an) * rr)
        }
        ctx.closePath()
        ctx.fill()
      } else {
        ctx.setTransform(dpr, 0, 0, dpr, dpr * q.x, dpr * q.y)
        ctx.fillStyle = s.color
        ctx.beginPath()
        ctx.arc(0, 0, q.size * 0.22, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.globalAlpha = 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }
}

/** The sakura theme's petals (cut one by one from the petal photo). Loaded once, on first use. */
let petals: Promise<Sprite[]> | null = null
export function petalSprites(): Promise<Sprite[]> {
  petals ??= Promise.all(
    [1, 2, 3, 4].map(
      (i) =>
        new Promise<Sprite | null>((resolve) => {
          const img = new Image()
          img.decoding = 'async'
          img.onload = () => resolve({ kind: 'image', img, ratio: img.naturalHeight / img.naturalWidth })
          img.onerror = () => resolve(null)
          img.src = `/themes/sakura/petal-${i}.webp`
        }),
    ),
  ).then((list) => list.filter((s): s is Sprite => s !== null))
  return petals
}

export const MONO = "ui-monospace, 'Cascadia Mono', 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace"
