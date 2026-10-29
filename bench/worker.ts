/**
 * Local benchmark worker: runs the production matching and tailoring code with any model.
 * Start with `npx wrangler dev -c bench/wrangler.jsonc --port 8812`, then run `node bench/run.mjs`.
 */
import { masterContent, seedLibrary } from '../shared/seed'
import type { JobAnalysis, ResumeContent } from '../shared/types'
import type { Usage } from '../worker/ai'
import { analyzeJob, scoreCv } from '../worker/match'
import { tailor } from '../worker/tailor'
import { JOBS } from './jobs.mjs'

const TODAY = new Date('2026-10-09T12:00:00Z')

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const body = (await request.json()) as {
      action: 'analyze' | 'score' | 'tailor'
      jobId: string
      provider: 'openai' | 'workers-ai' | 'anthropic'
      model: string
      analysis?: JobAnalysis
      /** CV to score instead of the master CV */
      content?: ResumeContent
      plain?: boolean
    }
    const job = JOBS.find((j) => j.id === body.jobId)
    if (!job) return Response.json({ ok: false, error: 'unknown job' }, { status: 404 })
    const usage: Usage[] = []
    const model = { provider: body.provider, model: body.model }
    const started = Date.now()
    try {
      if (body.action === 'analyze') {
        const result = await analyzeJob(env, { title: job.title, company: job.company, text: job.text }, { model, usage })
        return Response.json({ ok: true, ms: Date.now() - started, usage, ...result })
      }
      if (body.action === 'tailor') {
        const posting = { title: job.title, company: job.company, url: '', description: job.text }
        // The production endpoint hands the requirement list to the tailoring; --plain measures without it.
        const result = await tailor(env, masterContent, 'en', seedLibrary, posting, true, body.plain ? null : body.analysis, { model, usage })
        return Response.json({ ok: true, ms: Date.now() - started, usage, ...result })
      }
      const score = await scoreCv(env, body.content ?? masterContent, 'en', body.analysis!, { model, usage, today: TODAY })
      return Response.json({ ok: true, ms: Date.now() - started, usage, score })
    } catch (err) {
      return Response.json({ ok: false, ms: Date.now() - started, usage, error: (err as Error).message })
    }
  },
}
