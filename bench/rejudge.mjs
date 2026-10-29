/**
 * Re-scores stored tailored CVs with another judge, to rule out a judge preferring its own writing.
 *   node bench/rejudge.mjs results/tailor-v2.json terra
 */
import { readFileSync } from 'node:fs'
import { MODELS } from './run.mjs'

const [file, judgeKey = 'terra'] = process.argv.slice(2)
const judge = MODELS[judgeKey]
const data = JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'))
const endpoint = 'http://127.0.0.1:8812'

async function score(jobId, analysis, content) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'score', jobId, provider: judge.provider, model: judge.model, analysis, content }),
    })
    const out = await res.json().catch(() => ({ ok: false }))
    if (out.ok) return out.score.overall
  }
  return null
}

const totals = {}
await Promise.all(
  Object.entries(data.jobs).map(async ([jobId, entry]) => {
    const base = await score(jobId, entry.analysis, undefined)
    for (const [model, runs] of Object.entries(entry.models)) {
      for (const run of runs) {
        if (run.error) continue
        const s = await score(jobId, entry.analysis, run.content)
        if (s == null || base == null) continue
        ;(totals[model] ??= []).push({ s, uplift: s - base })
        console.log(`  ${model.padEnd(6)} ${jobId.padEnd(22)} master ${base} → ${s}`)
      }
    }
  }),
)
console.log(`\njudge ${judge.model}`)
for (const [model, rows] of Object.entries(totals)) {
  const avg = (f) => (rows.reduce((a, r) => a + f(r), 0) / rows.length).toFixed(1)
  console.log(`  ${model.padEnd(6)} avg ${avg((r) => r.s)}  uplift +${avg((r) => r.uplift)}  (n=${rows.length})`)
}
