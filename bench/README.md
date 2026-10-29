# Job-match benchmark

Measures how well each model reads a job posting and judges the master CV against it, with the exact production code (`worker/match.ts`, `worker/tailor.ts`).

- `jobs.mjs`: 8 fictional but realistic postings (EN, ES, DE) from strong fit to no fit, each with the expected overall score range and "probes": requirements that must be extracted and judged with a given verdict.
- `worker.ts` + `wrangler.jsonc`: a local-only Worker that runs `analyze`, `score` and `tailor` with any model.
- `run.mjs`: scoring benchmark (extraction, verdict accuracy, score in range, rank correlation, run-to-run drift, unverifiable evidence, latency, cost).
- `tailor.mjs`: which model writes the most hireable CV (tailored CV scored by one fixed judge, plus fact-check corrections).

```bash
cp .dev.vars bench/.dev.vars                          # needs OPENAI_API_KEY
npx wrangler dev -c bench/wrangler.jsonc --port 8812  # keep running
node bench/run.mjs --models luna,mini,terra --runs 2
node bench/tailor.mjs --models luna,mini --judge luna
node bench/tailor.mjs --models luna --reuse results/tailor-v2.json   # reuse stored requirement lists (cheaper, like for like)
```

The tailoring benchmark passes each posting's requirement list to the CV maker, as production does. Set `plain: true` in the request (see `worker.ts`) to measure without it.

Don't edit `worker/` while a run is in progress: the Worker reloads and in-flight calls fail. Results are written to `bench/results/`.
