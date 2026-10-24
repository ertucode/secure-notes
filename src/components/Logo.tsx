import { ShieldCheck } from 'lucide-react'

export function Logo() {
  return (
    <div className="logo" aria-label="Ciphernote">
      <span className="logo-mark"><ShieldCheck size={19} strokeWidth={2.4} /></span>
      <span>Ciphernote</span>
    </div>
  )
}
