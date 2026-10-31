import type { ComponentType } from 'react'
import type { TemplateId } from '@shared/types'
import type { TemplateProps } from './shared'
import Signature from './Signature'
import Atlantic from './Atlantic'
import Mercury from './Mercury'
import Steady from './Steady'
import Serif from './Serif'
import Leaves from './Leaves'
import Executive from './Executive'
import Latex from './Latex'
import Scholar from './Scholar'
import './base.css'
import './signature.css'
import './generic.css'
import './themes.css'

export const TEMPLATE_COMPONENTS: Record<TemplateId, ComponentType<TemplateProps>> = {
  signature: Signature,
  atlantic: Atlantic,
  mercury: Mercury,
  steady: Steady,
  serif: Serif,
  leaves: Leaves,
  executive: Executive,
  latex: Latex,
  scholar: Scholar,
}
