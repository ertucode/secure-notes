import { GitFork, KeyRound, LockKeyhole, ShieldCheck } from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useVault } from '~/context/VaultContext'
import { Logo } from './Logo'

export function VaultGate({ children }: { children: ReactNode }) {
  const vault = useVault()
  const [token, setToken] = useState('')
  const [repository, setRepository] = useState('')
  const [password, setPassword] = useState('')

  useEffect(() => { setToken(vault.savedToken); setRepository(vault.repository) }, [vault.savedToken, vault.repository])

  async function submit(event: FormEvent) {
    event.preventDefault()
    const enteredPassword = password
    setPassword('')
    try { await vault.unlock({ token, repository, password: enteredPassword }) } catch { /* rendered by context */ }
  }

  if (vault.status === 'unlocked') return children
  return (
    <main className="unlock-page">
      <div className="unlock-card">
        <Logo />
        <div className="unlock-icon"><LockKeyhole size={24} /></div>
        <p className="eyebrow">Encrypted GitHub vault</p>
        <h1>Unlock your notes</h1>
        <p className="unlock-intro">Connect a repository and decrypt your notes locally in this browser.</p>
        <form onSubmit={submit} className="unlock-form" autoComplete="off">
          <label><span>Repository URL</span><div className="unlock-input"><GitFork size={17} /><input type="url" required value={repository} onChange={(event) => setRepository(event.target.value)} placeholder="https://github.com/you/notes" autoComplete="url" /></div></label>
          <label><span>Fine-grained access token</span><div className="unlock-input"><ShieldCheck size={17} /><input type="password" required value={token} onChange={(event) => setToken(event.target.value)} placeholder="github_pat_…" autoComplete="off" /></div><small>Stored in this browser’s local storage. Grant repository Contents access only.</small></label>
          <label><span>Vault password</span><div className="unlock-input"><KeyRound size={17} /><input type="password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Never stored — not even locally" autoComplete="off" spellCheck={false} data-1p-ignore data-lpignore="true" /></div><small>Used to derive a non-extractable key, then immediately discarded.</small></label>
          {vault.error && <p className="unlock-error" role="alert">{vault.error}</p>}
          <button className="primary-button unlock-button" disabled={vault.status === 'unlocking'}>{vault.status === 'unlocking' ? 'Unlocking and decrypting…' : 'Unlock vault'}</button>
        </form>
        <div className="security-note"><LockKeyhole size={14} /><span>Files are encrypted and decrypted on this device. The key and plaintext are never sent to GitHub or the application server.</span></div>
      </div>
    </main>
  )
}
