import { useRef, useState } from 'react'
import { ChevronDown, ChevronUp, ImagePlus, Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { Contact, ContactType } from '@shared/types'
import { newContact } from '@shared/utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { api } from '@/lib/api'
import { squareJpeg } from '@/lib/image'
import { ContactIcon } from '@/templates/shared'
import { moveInArray, reorder, useContent, useEditor } from '../store'

const CONTACT_TYPES: { value: ContactType; label: string }[] = [
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'location', label: 'Location' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'github', label: 'GitHub' },
  { value: 'website', label: 'Website' },
  { value: 'other', label: 'Other' },
]

/** Text that differs per language (translated); everything else is shared by all languages. */
const isLocalized = (c: Contact) => c.type === 'location' || c.type === 'other'

export default function PersonalCard() {
  const content = useContent()
  const photo = useEditor((s) => s.resume?.photo)
  const showPhoto = useEditor((s) => s.resume?.style.showPhoto)
  const [open, setOpen] = useState(false)
  if (!content) return null
  const { personal } = content

  return (
    <div className="relative rounded-2xl bg-card ring-hairline p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] ring-1">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="absolute top-3 right-3 bg-primary text-primary-foreground grid size-8 place-items-center rounded-full shadow-sm transition-transform hover:scale-105"
        title="Edit personal details"
      >
        <Pencil className="size-3.5" />
      </button>
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold">{personal.name || 'Your name'}</h2>
          {personal.headline && <p className="text-muted-foreground truncate text-sm">{personal.headline}</p>}
          <ul className="text-foreground/80 mt-3 grid gap-2 text-sm">
            {personal.contacts
              .filter((c) => c.value)
              .slice(0, 4)
              .map((c) => (
                <li key={c.id} className="flex min-w-0 items-center gap-2.5">
                  <ContactIcon type={c.type} className="text-muted-foreground size-4 shrink-0" />
                  <span className="truncate">{c.value}</span>
                </li>
              ))}
          </ul>
        </div>
        {photo && (
          <img
            src={photo}
            alt=""
            className={`size-24 shrink-0 rounded-full object-cover sm:size-28 ${showPhoto ? '' : 'opacity-40 grayscale'}`}
          />
        )}
      </div>
      <PersonalDialog open={open} onOpenChange={setOpen} />
    </div>
  )
}

function PersonalDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const content = useContent()
  const resume = useEditor((s) => s.resume)
  const lang = useEditor((s) => s.lang)
  const { update, updateContent, updateAllLangs } = useEditor.getState()
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  if (!content || !resume) return null
  const { personal } = content

  const setContact = (c: Contact, key: 'type' | 'value' | 'url', value: string) => {
    const apply = (draft: { personal: { contacts: Contact[] } }) => {
      const target = draft.personal.contacts.find((x) => x.id === c.id)
      if (target) (target as unknown as Record<string, string>)[key] = value
    }
    if (key === 'value' && isLocalized(c)) updateContent(apply)
    else updateAllLangs(apply)
  }

  const upload = async (file: File) => {
    setUploading(true)
    try {
      const blob = await squareJpeg(file)
      const { url } = await api.uploadImage(blob)
      update((d) => {
        d.photo = url
        d.style.showPhoto = true
      })
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Personal details</DialogTitle>
          <DialogDescription>
            Name, photo and contact links are shared by every language. Headline and location are translated.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-4">
          <div className="relative">
            {resume.photo ? (
              <img src={resume.photo} alt="" className="ring-hairline size-20 rounded-full object-cover ring-1" />
            ) : (
              <div className="bg-muted text-muted-foreground grid size-20 place-items-center rounded-full">
                <ImagePlus className="size-6" />
              </div>
            )}
            {uploading && (
              <div className="bg-background/70 absolute inset-0 grid place-items-center rounded-full">
                <Loader2 className="size-5 animate-spin" />
              </div>
            )}
          </div>
          <div className="grid gap-2">
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
                <ImagePlus /> {resume.photo ? 'Replace photo' : 'Upload photo'}
              </Button>
              {resume.photo && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    update((d) => {
                      d.photo = ''
                    })
                  }
                >
                  Remove
                </Button>
              )}
            </div>
            <label className="text-muted-foreground flex items-center gap-2 text-sm">
              <Switch
                checked={resume.style.showPhoto}
                onCheckedChange={(v) =>
                  update((d) => {
                    d.style.showPhoto = v
                  })
                }
              />
              Show photo on the CV
            </label>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void upload(f)
              e.target.value = ''
            }}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label className="text-muted-foreground text-xs">Full name</Label>
            <Input
              value={personal.name}
              onChange={(e) =>
                updateAllLangs((c) => {
                  c.personal.name = e.target.value
                })
              }
            />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-muted-foreground text-xs">Headline ({lang.toUpperCase()})</Label>
            <Input
              value={personal.headline}
              placeholder="e.g. Data Engineer"
              onChange={(e) =>
                updateContent((c) => {
                  c.personal.headline = e.target.value
                })
              }
            />
          </div>
        </div>

        <div className="grid gap-2">
          <Label className="text-muted-foreground text-xs">Contact</Label>
          {personal.contacts.map((c, i) => (
            <div key={c.id} className="grid grid-cols-[7.5rem_1fr_auto] items-start gap-2">
              <Select value={c.type} onValueChange={(v) => setContact(c, 'type', v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONTACT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      <ContactIcon type={t.value} className="size-3.5" />
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="grid gap-1.5">
                <Input value={c.value} placeholder="Shown on the CV" onChange={(e) => setContact(c, 'value', e.target.value)} />
                {!['email', 'phone', 'location'].includes(c.type) && (
                  <Input
                    value={c.url}
                    placeholder="Link (https://…)"
                    className="h-7 text-xs"
                    onChange={(e) => setContact(c, 'url', e.target.value)}
                  />
                )}
              </div>
              <div className="flex">
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={i === 0}
                  onClick={() =>
                    updateAllLangs((d) => {
                      d.personal.contacts = reorder(d.personal.contacts, moveInArray(personal.contacts, c.id, -1))
                    })
                  }
                >
                  <ChevronUp />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={i === personal.contacts.length - 1}
                  onClick={() =>
                    updateAllLangs((d) => {
                      d.personal.contacts = reorder(d.personal.contacts, moveInArray(personal.contacts, c.id, 1))
                    })
                  }
                >
                  <ChevronDown />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="hover:text-destructive"
                  onClick={() =>
                    updateAllLangs((d) => {
                      d.personal.contacts = d.personal.contacts.filter((x) => x.id !== c.id)
                    })
                  }
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground justify-self-start"
            onClick={() => {
              const c = newContact()
              updateAllLangs((d) => {
                d.personal.contacts.push({ ...c })
              })
            }}
          >
            <Plus /> Add contact
          </Button>
          <p className="text-muted-foreground text-xs">
            Two-column templates lay contacts out row by row: 1st &amp; 2nd on the first row, and so on.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
