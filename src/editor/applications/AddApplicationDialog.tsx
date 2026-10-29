import { useEffect, useState, type FormEvent } from 'react'
import { FileText, Link2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { Stage } from '@shared/types'
import { boardStages } from '@shared/utils'
import { CompanyLogo } from '@/components/CompanyLogo'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useEditor } from '../store'
import { stageDot, useStageLabel } from './stages'
import { logoFor, useApplications } from './store'

const NO_CV = 'none'
const EMPTY = { url: '', title: '', company: '', location: '', logo: '', description: '' }

export default function AddApplicationDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const list = useEditor((s) => s.list)
  const apps = useApplications((s) => s.items)
  const stages = boardStages(useApplications((s) => s.columns))
  const label = useStageLabel()
  const [job, setJob] = useState(EMPTY)
  const [stage, setStage] = useState<Stage>('saved')
  const [resumeId, setResumeId] = useState(NO_CV)
  const [busy, setBusy] = useState<'read' | 'save' | null>(null)
  const [readFrom, setReadFrom] = useState('')

  useEffect(() => {
    if (!open) return
    setJob(EMPTY)
    setStage('saved')
    setResumeId(NO_CV)
    setReadFrom('')
  }, [open])

  const field = (key: keyof typeof EMPTY) => ({
    value: job[key],
    onChange: (e: { target: { value: string } }) => setJob((j) => ({ ...j, [key]: e.target.value })),
  })

  const read = async () => {
    setBusy('read')
    try {
      const found = await api.readLink(job.url.trim())
      setJob({
        url: found.url,
        title: found.title,
        company: found.company,
        location: found.location,
        logo: found.logo,
        description: found.description,
      })
      setReadFrom(found.source)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!job.title.trim() && !job.company.trim()) return
    setBusy('save')
    try {
      const cv = list.find((m) => m.id === resumeId)
      await useApplications.getState().create({
        ...job,
        title: job.title.trim(),
        company: job.company.trim(),
        url: job.url.trim(),
        stage,
        resumeId: cv?.id ?? null,
        lang: cv?.sourceLang ?? null,
      })
      onOpenChange(false)
      toast.success(`Added to “${label(stage)}”`)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={save} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Add an application</DialogTitle>
            <DialogDescription>Paste the job link to fill in the details and the company logo (no AI needed), or type them.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-1.5">
            <Label className="text-muted-foreground text-xs">Job link</Label>
            <div className="flex gap-2">
              <Input
                {...field('url')}
                placeholder="https://www.linkedin.com/jobs/view/…"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && job.url.trim()) {
                    e.preventDefault()
                    void read()
                  }
                }}
                disabled={busy !== null}
              />
              <Button type="button" variant="outline" onClick={() => void read()} disabled={busy !== null || !job.url.trim()} className="shrink-0">
                {busy === 'read' ? <Loader2 className="animate-spin" /> : <Link2 />}
                Read
              </Button>
            </div>
            {readFrom && <p className="text-muted-foreground text-xs">Read via {readFrom}. Check the fields below.</p>}
          </div>

          <div className="flex items-start gap-3">
            <CompanyLogo src={job.logo} name={job.company || job.title} size={40} className="mt-5.5" />
            <div className="grid flex-1 gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label className="text-muted-foreground text-xs">Job title</Label>
                <Input {...field('title')} placeholder="Data Engineer" disabled={busy === 'read'} />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-muted-foreground text-xs">Company</Label>
                <Input {...field('company')} placeholder="Acme" disabled={busy === 'read'} />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-muted-foreground text-xs">Location</Label>
                <Input {...field('location')} placeholder="Berlin" disabled={busy === 'read'} />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-muted-foreground text-xs">Stage</Label>
                <Select value={stage} onValueChange={(v) => setStage(v as Stage)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    {stages.map((s) => (
                      <SelectItem key={s} value={s}>
                        <span className={cn('size-2 rounded-full', stageDot(s))} />
                        {label(s)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5 sm:col-span-2">
                <Label className="text-muted-foreground text-xs">CV</Label>
                <Select value={resumeId} onValueChange={setResumeId}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper" className="max-h-72">
                    <SelectItem value={NO_CV}>No CV yet</SelectItem>
                    {list.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.kind === 'tailored' ? (
                          <CompanyLogo src={logoFor(apps, m)} name={m.job?.company || m.name} size={18} />
                        ) : (
                          <FileText />
                        )}
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy !== null || (!job.title.trim() && !job.company.trim())}>
              {busy === 'save' && <Loader2 className="animate-spin" />}
              Add application
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
