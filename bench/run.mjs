/**
 * Job-match benchmark runner.
 *   npx wrangler dev -c bench/wrangler.jsonc --port 8812   (in another terminal)
 *   node bench/run.mjs --models luna,mini --runs 2
 * Writes bench/results/<timestamp>.json and prints a summary.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { JOBS } from './jobs.mjs'

const NEURON_PRICE = 0.011 / 1000 // $ per neuron beyond the free 10k/day

export const MODELS = {
  luna: { provider: 'openai', model: 'gpt-5.6-luna', price: [0.2, 1.2] },
  nano: { provider: 'openai', model: 'gpt-5.4-nano', price: [0.2, 1.25] },
  mini: { provider: 'openai', model: 'gpt-5.4-mini', price: [0.75, 4.5] },
  terra: { provider: 'openai', model: 'gpt-5.6-terra', price: [2, 12] },
  sol: { provider: 'openai', model: 'gpt-5.6-sol', price: [4, 20] },
  'oss-120b': { provider: 'workers-ai', model: '@cf/openai/gpt-oss-120b', neurons: [31818, 68182] },
  'oss-20b': { provider: 'workers-ai', model: '@cf/openai/gpt-oss-20b', neurons: [18182, 27273] },
  gemma: { provider: 'workers-ai', model: '@cf/google/gemma-4-26b-a4b-it', neurons: [9091, 27273] },
  glm: { provider: 'workers-ai', model: '@cf/zai-org/glm-4.7-flash', neurons: [5500, 36400] },
  qwen: { provider: 'workers-ai', model: '@cf/qwen/qwen3-30b-a3b-fp8', neurons: [4625, 30475] },
}

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
)
const models = (args.models ?? 'luna,mini').split(',')
const jobs = args.jobs ? JOBS.filter((j) => args.jobs.split(',').includes(j.id)) : JOBS
const runs = Number(args.runs ?? 2)
const concurrency = Number(args.concurrency ?? 4)
const endpoint = args.endpoint ?? 'http://127.0.0.1:8812'

async function call(body) {
  for (let attempt = 0; ; attempt++) {
    let data
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const raw = await res.text()
      data = JSON.parse(raw.startsWith('{') ? raw : JSON.stringify({ ok: false, error: `worker: ${raw.slice(0, 120)}` }))
    } catch (err) {
      data = { ok: false, error: `transport: ${err.message}` }
    }
    if (data.ok || attempt >= 1 || !/rate limit|timeout|429|5\d\d|malformed|unexpected|worker:|transport:/i.test(data.error ?? '')) return data
    await new Promise((r) => setTimeout(r, 4000))
  }
}

async function pool(items, size, fn) {
  const out = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i], i)
      }
    }),
  )
  return out
}

function cost(spec, usage = []) {
  let dollars = 0
  let neurons = 0
  for (const u of usage) {
    if (spec.price) dollars += (u.input * spec.price[0] + u.output * spec.price[1]) / 1e6
    if (spec.neurons) neurons += (u.input * spec.neurons[0] + u.output * spec.neurons[1]) / 1e6
  }
  return { dollars: spec.price ? dollars : neurons * NEURON_PRICE, neurons }
}

async function runModel(key) {
  const spec = MODELS[key]
  if (!spec) throw new Error(`unknown model ${key}`)
  return pool(jobs, concurrency, async (job) => {
    const analysis = await call({ action: 'analyze', jobId: job.id, provider: spec.provider, model: spec.model })
    const scores = []
    if (analysis.ok) {
      for (let r = 0; r < runs; r++) {
        scores.push(await call({ action: 'score', jobId: job.id, provider: spec.provider, model: spec.model, analysis: analysis.analysis }))
      }
    }
    const tag = analysis.ok ? scores.map((s) => (s.ok ? s.score.overall : 'ERR')).join('/') : `ANALYSIS ERR: ${analysis.error}`
    console.log(`  ${key.padEnd(9)} ${job.id.padEnd(22)} ${tag}`)
    return { jobId: job.id, analysis, scores }
  })
}

/* ---------------------------------- metrics --------------------------------- */

function ranks(values) {
  const sorted = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0])
  const r = new Array(values.length)
  for (let i = 0; i < sorted.length; ) {
    let j = i
    while (j + 1 < sorted.length && sorted[j + 1][0] === sorted[i][0]) j++
    for (let k = i; k <= j; k++) r[sorted[k][1]] = (i + j) / 2 + 1
    i = j + 1
  }
  return r
}

function spearman(a, b) {
  const ra = ranks(a)
  const rb = ranks(b)
  const mean = (x) => x.reduce((s, v) => s + v, 0) / x.length
  const ma = mean(ra)
  const mb = mean(rb)
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < ra.length; i++) {
    num += (ra[i] - ma) * (rb[i] - mb)
    da += (ra[i] - ma) ** 2
    db += (rb[i] - mb) ** 2
  }
  return num / Math.sqrt(da * db)
}

export function evaluate(key, results) {
  const spec = MODELS[key]
  const m = {
    probes: 0, extracted: 0, correct: 0, judged: 0, checks: 0, checksOk: 0, bandHits: 0, bandRuns: 0, bandDist: 0,
    diffs: [], flips: 0, flipBase: 0, unverified: 0, reqs: 0, rejected: 0, errors: 0, analysisMs: [], scoreMs: [],
    analysisCost: [], scoreCost: [], neurons: 0, failures: [], overall: [], gold: [],
  }
  for (const res of results) {
    const job = JOBS.find((j) => j.id === res.jobId)
    const a = res.analysis
    if (!a.ok) {
      m.errors++
      m.probes += job.probes.length * runs
      m.failures.push(`${job.id}: analysis error ${a.error}`)
      continue
    }
    m.analysisMs.push(a.ms)
    const ac = cost(spec, a.usage)
    m.analysisCost.push(ac.dollars)
    m.neurons += ac.neurons
    m.rejected += a.rejected.length
    const reqs = a.analysis.requirements
    m.reqs += reqs.length
    for (const p of job.probes) {
      const req = reqs.find((r) => p.match.test(r.text))
      if (req && p.importance) { m.checks++; if (req.importance === p.importance) m.checksOk++; else m.failures.push(`${job.id}: "${req.text}" importance ${req.importance}, expected ${p.importance}`) }
      if (req && p.knockout !== undefined) { m.checks++; if (req.knockout === p.knockout) m.checksOk++; else m.failures.push(`${job.id}: "${req.text}" knockout ${req.knockout}, expected ${p.knockout}`) }
    }
    const okScores = res.scores.filter((s) => s.ok)
    m.errors += res.scores.length - okScores.length
    for (const s of res.scores.filter((x) => !x.ok)) m.failures.push(`${job.id}: score error ${s.error}`)
    for (const s of okScores) {
      m.scoreMs.push(s.ms)
      const sc = cost(spec, s.usage)
      m.scoreCost.push(sc.dollars)
      m.neurons += sc.neurons
      m.unverified += s.score.unverified.length
      m.bandRuns++
      const x = s.score.overall
      const [lo, hi] = job.band
      if (x >= lo && x <= hi) m.bandHits++
      else m.failures.push(`${job.id}: overall ${x} outside ${lo}–${hi}${s.score.cap ? ` (cap: ${s.score.cap.reason})` : ''}`)
      m.bandDist += Math.max(0, lo - x, x - hi)
      for (const p of job.probes) {
        m.probes++
        const req = reqs.find((r) => p.match.test(r.text))
        if (!req) { m.failures.push(`${job.id}: probe ${p.match} not extracted`); continue }
        m.extracted++
        const verdict = s.score.requirements.find((r) => r.id === req.id)?.verdict
        m.judged++
        if (p.accept.includes(verdict)) m.correct++
        else m.failures.push(`${job.id}: "${req.text}" → ${verdict} (expected ${p.accept.join('/')}) · ${s.score.requirements.find((r) => r.id === req.id)?.reason ?? ''}`)
      }
    }
    // Probes are counted per run; missing runs count as failures.
    m.probes += job.probes.length * (runs - okScores.length)
    if (okScores.length >= 2) {
      m.diffs.push(Math.abs(okScores[0].score.overall - okScores[1].score.overall))
      const v0 = new Map(okScores[0].score.requirements.map((r) => [r.id, r.verdict]))
      for (const r of okScores[1].score.requirements) { m.flipBase++; if (v0.get(r.id) !== r.verdict) m.flips++ }
    }
    if (okScores.length) {
      m.overall.push(okScores.reduce((s, x) => s + x.score.overall, 0) / okScores.length)
      m.gold.push((job.band[0] + job.band[1]) / 2)
    }
  }
  const avg = (x) => (x.length ? x.reduce((s, v) => s + v, 0) / x.length : NaN)
  return {
    model: key,
    probeAccuracy: m.correct / m.probes,
    extraction: m.extracted / Math.max(1, m.judged + (m.probes - m.judged)),
    verdictAccuracy: m.correct / Math.max(1, m.judged),
    flags: m.checks ? m.checksOk / m.checks : NaN,
    bandHit: m.bandHits / Math.max(1, m.bandRuns),
    bandDist: m.bandDist / Math.max(1, m.bandRuns),
    spearman: m.overall.length > 2 ? spearman(m.overall, m.gold) : NaN,
    drift: avg(m.diffs),
    flipRate: m.flipBase ? m.flips / m.flipBase : NaN,
    unverifiedPerScore: m.unverified / Math.max(1, m.bandRuns),
    rejectedPerJob: m.rejected / Math.max(1, results.length),
    reqsPerJob: m.reqs / Math.max(1, results.length),
    errors: m.errors,
    analysisMs: avg(m.analysisMs),
    scoreMs: avg(m.scoreMs),
    costPerJob: avg(m.analysisCost) + avg(m.scoreCost),
    neurons: m.neurons,
    failures: m.failures,
  }
}

export function printTable(rows) {
  const pct = (x) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : '–')
  const n = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '–')
  console.log('\nmodel      probes  extract verdict flags  band   dist  rho   drift flips unverif rejected reqs  err  analyze  score   $/job')
  for (const r of rows) {
    console.log(
      [
        r.model.padEnd(10),
        pct(r.probeAccuracy).padStart(6),
        pct(r.extraction).padStart(7),
        pct(r.verdictAccuracy).padStart(7),
        pct(r.flags).padStart(5),
        pct(r.bandHit).padStart(5),
        n(r.bandDist).padStart(6),
        n(r.spearman, 2).padStart(5),
        n(r.drift).padStart(5),
        pct(r.flipRate).padStart(5),
        n(r.unverifiedPerScore).padStart(7),
        n(r.rejectedPerJob).padStart(8),
        n(r.reqsPerJob).padStart(5),
        String(r.errors).padStart(4),
        `${n(r.analysisMs / 1000)}s`.padStart(8),
        `${n(r.scoreMs / 1000)}s`.padStart(6),
        `$${r.costPerJob.toFixed(4)}`.padStart(8),
      ].join(' '),
    )
  }
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('run.mjs')) {
  mkdirSync(new URL('./results/', import.meta.url), { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const all = {}
  for (const key of models) {
    console.log(`\n${key} (${MODELS[key].model})`)
    all[key] = await runModel(key)
    writeFileSync(new URL(`./results/${args.out ?? stamp}.json`, import.meta.url), JSON.stringify({ runs, models, results: all }, null, 1))
  }
  const rows = models.map((k) => evaluate(k, all[k]))
  printTable(rows)
  for (const r of rows) {
    console.log(`\n${r.model} failures (${r.failures.length}):`)
    for (const f of r.failures.slice(0, 60)) console.log(`  - ${f}`)
  }
}

export function load(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}
