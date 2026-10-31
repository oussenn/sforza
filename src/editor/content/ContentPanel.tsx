import { useState } from 'react'
import { Copy, Languages, Loader2, Plus, RefreshCw } from 'lucide-react'
import { LABELS, TEMPLATE_MAP } from '@shared/templates'
import { LANG_LABELS, type SectionType } from '@shared/types'
import { clone, contentHash, isStale, newSection } from '@shared/utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useTranslate } from '../ai/useTranslate'
import { SECTION_BLURB, SECTION_ICON } from '../sectionIcons'
import { useEditor } from '../store'
import PersonalCard from './PersonalCard'
import SectionCard from './SectionCard'

const ADDABLE: SectionType[] = ['summary', 'experience', 'projects', 'education', 'skills', 'certifications', 'languages', 'custom']

export default function ContentPanel() {
  const resume = useEditor((s) => s.resume)
  const lang = useEditor((s) => s.lang)
  const { busy, progress, run } = useTranslate()
  const [adding, setAdding] = useState(false)
  if (!resume) return null
  const content = resume.content[lang]
  const source = LANG_LABELS[resume.sourceLang].name
  const aiOn = useEditor.getState().ai?.provider !== 'none'

  if (!content) {
    return (
      <div className="bg-card ring-hairline rounded-2xl p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04)] ring-1">
        <div className="bg-muted mb-4 grid size-11 place-items-center rounded-xl">
          <Languages className="size-5" />
        </div>
        <h2 className="text-lg font-semibold">No {LANG_LABELS[lang].name} version yet</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Generate it from the {source} CV with AI, or start from a copy and translate it yourself. The preview shows the {source} version
          meanwhile.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button onClick={() => void run([lang])} disabled={busy || !aiOn}>
            {busy ? <Loader2 className="animate-spin" /> : <Languages />}
            {busy ? progress : `Translate to ${LANG_LABELS[lang].name}`}
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              useEditor.getState().update((d) => {
                d.content[lang] = clone(resume.content[resume.sourceLang]!)
                d.translations[lang] = { sourceHash: contentHash(d.content[d.sourceLang]), at: new Date().toISOString() }
              })
            }
          >
            <Copy /> Copy {source} version
          </Button>
        </div>
      </div>
    )
  }

  const stale = isStale(resume, lang)

  return (
    <div className="flex flex-col gap-3">
      {lang !== resume.sourceLang && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200/70 bg-amber-50/80 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          <Languages className="mt-0.5 size-4 shrink-0" />
          <div className="flex-1">
            <p>
              Editing the <b>{LANG_LABELS[lang].name}</b> version.{' '}
              {stale ? `The ${source} CV changed since it was translated.` : 'Reordering and hiding apply to every language.'}
            </p>
            {stale && aiOn && (
              <Button size="sm" variant="outline" className="mt-2" disabled={busy} onClick={() => void run([lang])}>
                {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                {busy ? progress : 'Re-translate (overwrites edits in this language)'}
              </Button>
            )}
          </div>
        </div>
      )}

      <PersonalCard />
      {content.sections.map((section, i) => (
        <SectionCard key={section.id} section={section} index={i} count={content.sections.length} />
      ))}

      <div className="flex justify-center py-3">
        <Button
          onClick={() => setAdding(true)}
          className="h-12 gap-2 rounded-xl px-12 text-base font-semibold shadow-sm"
        >
          <Plus className="size-5" /> Add Content
        </Button>
      </div>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add content</DialogTitle>
            <DialogDescription>Pick a section type. It is added to every language of this CV.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {ADDABLE.map((type) => {
              const Icon = SECTION_ICON[type]
              const exists = content.sections.some((s) => s.type === type)
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => {
                    const section = newSection(type, lang, resume.template)
                    useEditor.getState().updateAllLangs((c, l) => {
                      c.sections.push({ ...clone(section), title: LABELS[l].sections[type] })
                    })
                    setAdding(false)
                  }}
                  className="flex items-start gap-3 rounded-xl border p-3 text-left hover:border-foreground/20 hover:bg-muted/50 transition-colors"
                >
                  <div className="bg-muted grid size-9 shrink-0 place-items-center rounded-lg">
                    <Icon className="size-4.5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      {LABELS.en.sections[type]}
                      {exists && <span className="text-muted-foreground text-xs font-normal">added</span>}
                    </div>
                    <div className="text-muted-foreground text-xs">{SECTION_BLURB[type]}</div>
                  </div>
                </button>
              )
            })}
          </div>
          <p className="text-muted-foreground text-xs">
            {TEMPLATE_MAP[resume.template].layout !== 'single' &&
              'New sections use the template’s default column. Change it from the section menu.'}
          </p>
        </DialogContent>
      </Dialog>
    </div>
  )
}
