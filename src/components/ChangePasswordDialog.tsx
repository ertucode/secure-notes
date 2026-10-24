import { KeyRound, X } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { useVault } from '~/context/VaultContext'
import { IconButton, PrimaryButton } from './ui'

type Props = {
  open: boolean
  onClose: () => void
}

export function ChangePasswordDialog({ open, onClose }: Props) {
  const vault = useVault()
  const [previousPassword, setPreviousPassword] = useState('')
  const [nextPassword, setNextPassword] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setPreviousPassword('')
    setNextPassword('')
    setError('')
  }, [open])

  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !vault.changingPassword) onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [open, onClose, vault.changingPassword])

  if (!open) return null

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    const previous = previousPassword
    const next = nextPassword
    setPreviousPassword('')
    setNextPassword('')
    try {
      await vault.changePassword(previous, next)
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not change the vault password.')
    }
  }

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/70 px-5 py-10 backdrop-blur-[2px]" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !vault.changingPassword) onClose() }}>
      <section className="w-[min(430px,100%)] rounded-xl border border-[var(--background-modifier-border)] bg-[var(--background-primary)] p-6 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="change-password-title">
        <div className="flex items-start justify-between gap-5">
          <div className="flex gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-vault-500 text-[var(--text-on-accent)]"><KeyRound size={20} /></div>
            <div><h2 id="change-password-title" className="m-0 text-lg font-semibold">Change vault password</h2><p className="mt-1.5 mb-0 text-[11px] leading-relaxed text-[var(--text-muted)]">Every note and attachment will be re-encrypted and saved to GitHub in one commit.</p></div>
          </div>
          <IconButton onClick={onClose} disabled={vault.changingPassword} aria-label="Close password dialog"><X size={18} /></IconButton>
        </div>
        <form className="mt-6 grid gap-4" onSubmit={submit} autoComplete="off">
          <label><span className="mb-1.5 block text-[10px] font-semibold text-[var(--text-muted)]">Current password</span><input className="h-11 w-full rounded-md border border-[var(--background-modifier-border)] bg-[var(--background-modifier-form-field)] px-3 text-xs text-[var(--text-normal)] outline-0 focus:border-[var(--interactive-accent)] focus:shadow-[0_0_0_2px_#7f6df240]" autoFocus type="password" required value={previousPassword} onChange={(event) => setPreviousPassword(event.target.value)} autoComplete="current-password" disabled={vault.changingPassword} /></label>
          <label><span className="mb-1.5 block text-[10px] font-semibold text-[var(--text-muted)]">New password</span><input className="h-11 w-full rounded-md border border-[var(--background-modifier-border)] bg-[var(--background-modifier-form-field)] px-3 text-xs text-[var(--text-normal)] outline-0 focus:border-[var(--interactive-accent)] focus:shadow-[0_0_0_2px_#7f6df240]" type="password" required minLength={8} value={nextPassword} onChange={(event) => setNextPassword(event.target.value)} autoComplete="new-password" disabled={vault.changingPassword} /></label>
          {error && <p className="m-0 rounded-md border border-[#5c292c] bg-[#3d2526] px-3 py-2.5 text-[10px] leading-relaxed text-[var(--text-error)]" role="alert">{error}</p>}
          <div className="mt-1 flex justify-end gap-2"><button className="min-h-[42px] cursor-pointer rounded-md border border-[var(--background-modifier-border)] bg-transparent px-4 text-xs font-semibold text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)]" type="button" onClick={onClose} disabled={vault.changingPassword}>Cancel</button><PrimaryButton type="submit" disabled={vault.changingPassword}>{vault.changingPassword ? 'Re-encrypting vault…' : 'Change password'}</PrimaryButton></div>
        </form>
      </section>
    </div>
  )
}
