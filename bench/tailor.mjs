/**
 * Which model writes the most hireable CV? Each model tailors the master CV (strict mode + library) to the
 * same postings; one fixed judge scores every result against one fixed requirement list per posting.
 *   node bench/tailor.mjs --models luna,mini,terra --judge luna
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { MODELS } from './run.mjs'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
)
const models = (args.models ?? 'luna,mini,terra').split(',')
const judge = MODELS[args.judge ?? 'luna']
const jobs = (args.jobs ?? 'werkstudent-data,data-analyst-es,crm-data-quality,bi-analyst').split(',')
const endpoint = args.endpoint ?? 'http://127.0.0.1:8812'

async function call(body) {
  for (let attempt = 0; ; attempt++) {
    let data
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const raw = await res.text()
      data = raw.startsWith('{') ? JSON.parse(raw) : { ok: false, error: `worker: ${raw.slice(0, 120)}` }
    } catch (err) {
      data = { ok: false, error: `transport: ${err.message}` }
    }
    if (data.ok || attempt >= 1) return data
    await new Promise((r) => setTimeout(r, 4000))
  }
}

const dollars = (spec, usage = []) =>
  usage.reduce((s, u) => s + (spec.price ? (u.input * spec.price[0] + u.output * spec.price[1]) / 1e6 : ((u.input * spec.neurons[0] + u.output * spec.neurons[1]) / 1e6) * 0.000011), 0)

const judgeCall = (jobId, action, extra = {}) => call({ action, jobId, provider: judge.provider, model: judge.model, ...extra })

const runs = Number(args.runs ?? 1)
const reused = args.reuse ? JSON.parse(readFileSync(new URL(args.reuse, import.meta.url), 'utf8')) : null
const out = { judge: judge.model, runs, jobs: {} }
await Promise.all(
  jobs.map(async (jobId) => {
    // --reuse results/x.json: the stored requirement lists, so runs compare like for like and cost less.
    const a = reused?.jobs[jobId]?.analysis ? { ok: true, analysis: reused.jobs[jobId].analysis } : await judgeCall(jobId, 'analyze')
    if (!a.ok) throw new Error(`analysis failed for ${jobId}: ${a.error}`)
    const baseline = await judgeCall(jobId, 'score', { analysis: a.analysis })
    const entry = { analysis: a.analysis, baseline: baseline.score, models: {} }
    await Promise.all(
      models.map(async (key) => {
        const spec = MODELS[key]
        entry.models[key] = []
        for (let r = 0; r < runs; r++) {
          const t = await call({ action: 'tailor', jobId, provider: spec.provider, model: spec.model, analysis: a.analysis })
          if (!t.ok) {
            entry.models[key].push({ error: t.error })
            console.log(`  ${key.padEnd(9)} ${jobId.padEnd(22)} TAILOR ERR ${t.error}`)
            continue
          }
          const s = await judgeCall(jobId, 'score', { analysis: a.analysis, content: t.content })
          const corrections = (t.notes.split('Fact check:')[1] ?? '').split('\n').filter((l) => l.trim().startsWith('- ')).length
          entry.models[key].push({ ms: t.ms, cost: dollars(spec, t.usage), corrections, notes: t.notes, content: t.content, score: s.score })
          console.log(`  ${key.padEnd(9)} ${jobId.padEnd(22)} master ${baseline.score?.overall} → ${s.score?.overall}  (${corrections} corrections, ${(t.ms / 1000).toFixed(0)}s)`)
        }
      }),
    )
    out.jobs[jobId] = entry
  }),
)

mkdirSync(new URL('./results/', import.meta.url), { recursive: true })
writeFileSync(new URL(`./results/tailor-${args.out ?? Date.now()}.json`, import.meta.url), JSON.stringify(out, null, 1))

console.log('\nmodel      avg score  uplift  keywords  corrections  time    $/CV')
for (const key of models) {
  const rows = Object.values(out.jobs)
    .flatMap((j) => j.models[key].map((m) => ({ base: j.baseline, m })))
    .filter((r) => r.m && !r.m.error && r.m.score)
  if (!rows.length) {
    console.log(`${key.padEnd(10)} failed`)
    continue
  }
  const avg = (f) => rows.reduce((s, r) => s + f(r), 0) / rows.length
  console.log(
    [
      key.padEnd(10),
      avg((r) => r.m.score.overall).toFixed(1).padStart(9),
      `+${avg((r) => r.m.score.overall - r.base.overall).toFixed(1)}`.padStart(7),
      `${avg((r) => r.m.score.dimensions.keywords ?? 0).toFixed(0)}%`.padStart(9),
      avg((r) => r.m.corrections).toFixed(1).padStart(12),
      `${(avg((r) => r.m.ms) / 1000).toFixed(0)}s`.padStart(6),
      `$${avg((r) => r.m.cost).toFixed(4)}`.padStart(8),
    ].join(' '),
  )
}
