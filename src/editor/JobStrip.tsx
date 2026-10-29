import { ChevronRight } from 'lucide-react'
import { CompanyLogo } from '@/components/CompanyLogo'
import { ScoreRing } from '@/components/ScoreRing'
import { applicationFor, useApplications } from './applications/store'
import { StageBadge } from './applications/stages'
import { navigate, setCvTab } from './router'
import { useEditor } from './store'

/** The job a tailored CV was made for, with its company logo and application stage. */
export default function JobStrip() {
  const resume = useEditor((s) => s.resume)
  const apps = useApplications((s) => s.items)
  const job = resume?.kind === 'tailored' ? resume.job : null
  if (!resume || !job) return null
  const app = applicationFor(apps, resume.id)

  return (
    <button
      type="button"
      onClick={() => (app ? navigate({ page: 'applications', appId: app.id }) : setCvTab('ai'))}
      title={app ? 'Open the application' : 'Open the job details'}
      className="bg-card ring-hairline hover:bg-muted/60 mb-3 flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left shadow-[0_1px_2px_rgba(0,0,0,0.04)] ring-1 transition-colors"
    >
      <CompanyLogo src={app?.logo || job.logo} name={job.company || job.title} size={34} />
      <div className="min-w-0 flex-1">
        <div className="text-muted-foreground text-[11px] leading-tight">Tailored for</div>
        <div className="truncate text-sm font-medium">
          {job.title}
          {job.company && <span className="text-muted-foreground font-normal"> · {job.company}</span>}
        </div>
      </div>
      {job.matchScore != null && <ScoreRing value={job.matchScore} size={30} stroke={2.5} title="Match score" />}
      {app && <StageBadge stage={app.stage} className="hidden sm:inline-flex" />}
      <ChevronRight className="text-muted-foreground size-4 shrink-0" />
    </button>
  )
}
