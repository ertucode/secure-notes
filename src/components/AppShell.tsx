import { useRouter, useRouterState } from '@tanstack/react-router'
import { FolderPlus, Plus, Search } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useVault } from '~/context/VaultContext'
import { Logo } from './Logo'
import { NoteTree, type NoteNavigationItem } from './NoteTree'

type Props = { children: ReactNode }

export function AppShell({ children }: Props) {
  const vault = useVault()
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const pathname = useRouterState({ select: (state) => state.location.pathname })

  async function createNote(folder: string[] = []) {
    setCreating(true)
    try {
      const note = await vault.createNote(folder)
      await router.navigate({ to: '/notes/$noteId', params: { noteId: note.id } })
    } catch (caught) {
      window.alert(caught instanceof Error ? caught.message : 'Could not create the note.')
    } finally {
      setCreating(false)
    }
  }

  async function createFolder() {
    const name = window.prompt('Folder name (use / for nested folders)')
    if (!name) return
    const folder = name.split('/').map((part) => part.trim()).filter(Boolean)
    if (!folder.length) return
    await createNote(folder)
  }

  async function openSearch() {
    await router.navigate({ to: '/' })
    window.setTimeout(() => document.querySelector<HTMLInputElement>('[data-note-search]')?.focus(), 0)
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Logo />
        <nav className="sidebar-actions" aria-label="Vault actions">
          <button disabled={creating} onClick={() => void createNote()}><Plus size={16} />New Note</button>
          <button disabled={creating} onClick={() => void createFolder()}><FolderPlus size={16} />New Folder</button>
          <button onClick={() => void openSearch()}><Search size={16} />Search</button>
        </nav>
        <NoteTree notes={vault.notes.map(({ id, title, folder }) => ({ id, title, folder })) satisfies NoteNavigationItem[]} />
      </aside>
      <main className={pathname.startsWith('/notes/') ? 'main editor-main' : 'main'}>{children}</main>
    </div>
  )
}
