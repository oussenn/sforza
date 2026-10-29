import { Award, Brain, Briefcase, FolderOpen, Globe, GraduationCap, IdCard, Star, type LucideIcon } from 'lucide-react'
import type { SectionType } from '@shared/types'

export const SECTION_ICON: Record<SectionType, LucideIcon> = {
  summary: IdCard,
  experience: Briefcase,
  projects: FolderOpen,
  education: GraduationCap,
  skills: Brain,
  certifications: Award,
  languages: Globe,
  custom: Star,
}

export const SECTION_BLURB: Record<SectionType, string> = {
  summary: 'A short pitch at the top of the CV',
  experience: 'Jobs, internships, freelance work',
  projects: 'Side projects, capstones, products',
  education: 'Degrees, schools, coursework',
  skills: 'Grouped technical skills',
  certifications: 'Certificates and licences',
  languages: 'Spoken languages and levels',
  custom: 'Awards, volunteering, publications…',
}
