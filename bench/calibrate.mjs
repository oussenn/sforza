/**
 * Offline calibration: recomputes overall scores from stored verdicts with alternative formulas, so the
 * scoring rules can be tuned without new model calls.
 *   node bench/calibrate.mjs results/full-openai-v2.json [results/other.json …]
 */
import { readFileSync } from 'node:fs'
import { JOBS } from './jobs.mjs'

const CATS = ['skills', 'experience', 'seniority', 'education', 'languages', 'location']
const VALUE = { met: 1, partial: 0.5, missing: 0, unknown: 0 }

function score(variant, analysis, verdictList, keywords) {
  const verdicts = new Map(verdictList.map((r) => [r.id, r.verdict]))
  const reqs = analysis.requirements
  const kw = keywords.length >= 3 ? (100 * keywords.filter((k) => k.found).length) / keywords.length : null
  const v = (r) => verdicts.get(r.id) ?? 'missing'
  const w = (r) => (r.importance === 'must' || r.knockout ? variant.must : 1)
  let overall
  if (variant.mode === 'dims') {
    const dims = {}
    for (const c of CATS) {
      let s = 0
      let t = 0
      for (const r of reqs.filter((x) => x.category === c)) {
        if (v(r) === 'unknown' && c === 'location') continue
        s += w(r) * VALUE[v(r)]
        t += w(r)
      }
      dims[c] = t ? (100 * s) / t : null
    }
    dims.keywords = kw
    let a = 0
    let b = 0
    for (const [d, weight] of Object.entries(variant.weights)) {
      if (dims[d] == null) continue
      a += weight * dims[d]
      b += weight
    }
    overall = b ? a / b : 0
  } else {
    let s = 0
    let t = 0
    for (const r of reqs) {
      if (v(r) === 'unknown' && r.category === 'location') continue
      const weight = w(r) * (variant.catMult[r.category] ?? 1)
      s += weight * VALUE[v(r)]
      t += weight
    }
    const req = t ? (100 * s) / t : 0
    overall = kw == null ? req : (1 - variant.kw) * req + variant.kw * kw
  }
  for (const r of reqs.filter((x) => x.knockout)) {
    let verdict = v(r)
    if (verdict === 'unknown' && r.category !== 'location') verdict = 'missing'
    const caps = r.category === 'seniority' ? variant.years : variant.hard
    const limit = verdict === 'missing' ? caps.missing : verdict === 'partial' ? caps.partial : null
    if (limit != null) overall = Math.min(overall, limit)
  }
  return Math.round(overall)
}

const DIM_WEIGHTS = { skills: 30, experience: 25, seniority: 10, education: 10, languages: 10, location: 5, keywords: 10 }
const VARIANTS = {
  'current (dims, partial caps)': { mode: 'dims', must: 3, weights: DIM_WEIGHTS, years: { missing: 50, partial: 75 }, hard: { missing: 35, partial: 60 } },
  'dims, no partial caps': { mode: 'dims', must: 3, weights: DIM_WEIGHTS, years: { missing: 50, partial: 101 }, hard: { missing: 35, partial: 101 } },
  'dims, years cap 40': { mode: 'dims', must: 3, weights: DIM_WEIGHTS, years: { missing: 40, partial: 101 }, hard: { missing: 35, partial: 101 } },
  'dims, heavier core': {
    mode: 'dims', must: 3, weights: { skills: 35, experience: 30, seniority: 10, education: 7, languages: 7, location: 3, keywords: 8 },
    years: { missing: 45, partial: 101 }, hard: { missing: 35, partial: 101 },
  },
  'production (requirements, kw 10%)': {
    mode: 'reqs', must: 3, kw: 0.1, catMult: { skills: 1, experience: 1, seniority: 1, education: 0.8, languages: 0.8, location: 0.5 },
    years: { missing: 50, partial: 101 }, hard: { missing: 35, partial: 101 },
  },
  'requirements, years cap 40': {
    mode: 'reqs', must: 3, kw: 0.1, catMult: { skills: 1, experience: 1, seniority: 1, education: 0.8, languages: 0.8, location: 0.5 },
    years: { missing: 40, partial: 101 }, hard: { missing: 35, partial: 101 },
  },
}

function spearman(a, b) {
  const rank = (x) => {
    const s = x.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0])
    const r = []
    for (let i = 0; i < s.length; ) {
      let j = i
      while (j + 1 < s.length && s[j + 1][0] === s[i][0]) j++
      for (let k = i; k <= j; k++) r[s[k][1]] = (i + j) / 2 + 1
      i = j + 1
    }
    return r
  }
  const ra = rank(a)
  const rb = rank(b)
  const m = (x) => x.reduce((p, q) => p + q, 0) / x.length
  const [ma, mb] = [m(ra), m(rb)]
  let n = 0
  let da = 0
  let db = 0
  ra.forEach((_, i) => {
    n += (ra[i] - ma) * (rb[i] - mb)
    da += (ra[i] - ma) ** 2
    db += (rb[i] - mb) ** 2
  })
  return n / Math.sqrt(da * db)
}

const files = process.argv.slice(2)
for (const [name, variant] of Object.entries(VARIANTS)) {
  const perModel = []
  for (const file of files) {
    const data = JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'))
    for (const [model, results] of Object.entries(data.results)) {
      let hits = 0
      let n = 0
      let dist = 0
      const drift = []
      const xs = []
      const gold = []
      const misses = []
      for (const res of results) {
        const job = JOBS.find((j) => j.id === res.jobId)
        if (!res.analysis.ok) continue
        const scores = res.scores.filter((s) => s.ok).map((s) => score(variant, res.analysis.analysis, s.score.requirements, s.score.keywords))
        for (const x of scores) {
          n++
          if (x >= job.band[0] && x <= job.band[1]) hits++
          else misses.push(`${job.id}=${x}`)
          dist += Math.max(0, job.band[0] - x, x - job.band[1])
        }
        if (scores.length >= 2) drift.push(Math.abs(scores[0] - scores[1]))
        if (scores.length) {
          xs.push(scores.reduce((p, q) => p + q, 0) / scores.length)
          gold.push((job.band[0] + job.band[1]) / 2)
        }
      }
      perModel.push({ model, hit: hits / n, dist: dist / n, drift: drift.reduce((p, q) => p + q, 0) / drift.length, rho: spearman(xs, gold), misses })
    }
  }
  console.log(`\n${name}`)
  for (const m of perModel) {
    console.log(`  ${m.model.padEnd(9)} in band ${String(Math.round(m.hit * 100)).padStart(3)}%  dist ${m.dist.toFixed(1).padStart(4)}  drift ${m.drift.toFixed(1).padStart(4)}  rho ${m.rho.toFixed(2)}  ${m.misses.join(' ')}`)
  }
}
