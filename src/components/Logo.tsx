import { ShieldCheck } from 'lucide-react'

export function Logo({ centered = false }: { centered?: boolean }) {
  return (
    <div className={`flex items-center gap-2.5 font-serif text-[21px] font-semibold tracking-[-0.3px] ${centered ? 'justify-center pb-[31px]' : 'px-2.5 min-[721px]:pb-[31px]'}`} aria-label="Ciphernote">
      <span className="grid size-[31px] place-items-center rounded-[9px] bg-vault-500 text-[var(--text-on-accent)]"><ShieldCheck size={19} strokeWidth={2.4} /></span>
      <span>Ciphernote</span>
    </div>
  )
}
