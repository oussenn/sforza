import { logoFor, useAppearance } from '@/lib/theme'

/** Sforza's portrait in the current theme's version: an oni mask in sakura, a hood in terminal, a helmet in space. */
export function Logo({ className }: { className?: string }) {
  const { look } = useAppearance()
  return <img src={logoFor(look)} alt="" className={className} decoding="sync" />
}
