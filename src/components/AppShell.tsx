import { useRouter } from '@tanstack/react-router'
import { FolderPlus, Plus, Search } from 'lucide-react'
import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { useVault } from '~/context/VaultContext'
import { Logo } from './Logo'
import { NoteTree, type NoteNavigationItem } from './NoteTree'

type Props = { children: ReactNode }

function SidebarAction(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className="flex min-h-[38px] w-9 cursor-pointer items-center justify-center gap-[9px] rounded-md border-0 bg-transparent p-0 text-left text-[0] font-medium text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)] disabled:cursor-wait disabled:opacity-55 min-[721px]:w-auto min-[721px]:justify-start min-[721px]:px-[11px] min-[721px]:text-xs [&_svg]:text-[var(--text-muted)]" {...props} />
}

export function AppShell({ children }: Props) {
  const vault = useVault()
  const router = useRouter()
  const [creating, setCreating] = useState(false)

  async function createNote(folder: string[] = []) {
    setCreating(true)
    try {
      const { note, persisted } = vault.createNote(folder)
      void persisted.catch((caught) => {
        window.alert(caught instanceof Error ? caught.message : 'Could not create the note. Your draft is still open; saving will retry.')
      })
      sessionStorage.setItem('ciphernote.focusNewNoteTitle', note.id)
      await router.navigate({ to: '/notes/$noteId', params: { noteId: note.id } })
    } catch (caught) {
      window.alert(caught instanceof Error ? caught.message : 'Could not create the note.')
    } finally {
      setCreating(false)
    }
  }

  async function createFolder(parent: string[] = []) {
    const name = window.prompt('Folder name (use / for nested folders)')
    if (!name) return
    const folder = [...parent, ...name.split('/').map((part) => part.trim()).filter(Boolean)]
    if (folder.length === parent.length) return
    setCreating(true)
    try {
      await vault.createFolder(folder)
    } catch (caught) {
      window.alert(caught instanceof Error ? caught.message : 'Could not create the folder.')
    } finally {
      setCreating(false)
    }
  }

  async function deleteFolder(folder: string[]) {
    const name = folder.join('/')
    if (!window.confirm(`Delete “${name}” and every note inside it permanently?`)) return
    const activeId = router.state.location.pathname.match(/^\/notes\/([^/]+)$/)?.[1]
    const activeNote = vault.notes.find((note) => note.id === activeId)
    const deletingActiveNote = activeNote?.folder.slice(0, folder.length).every((part, index) => part === folder[index]) ?? false
    try {
      await vault.deleteFolder(folder)
      if (deletingActiveNote) await router.navigate({ to: '/' })
    } catch (caught) {
      window.alert(caught instanceof Error ? caught.message : 'Could not delete the folder.')
    }
  }

  async function deleteNote(note: NoteNavigationItem) {
    if (!window.confirm(`Delete “${note.title}” from GitHub permanently?`)) return
    try {
      await vault.deleteNote(note.id)
      if (router.state.location.pathname === `/notes/${note.id}`) await router.navigate({ to: '/' })
    } catch (caught) {
      window.alert(caught instanceof Error ? caught.message : 'Could not delete the note.')
    }
  }

  async function moveNote(id: string, folder: string[]) {
    const isActive = router.state.location.pathname === `/notes/${id}`
    try {
      const moved = await vault.moveNote(id, folder)
      if (isActive && moved.id !== id) {
        await router.navigate({ to: '/notes/$noteId', params: { noteId: moved.id }, replace: true })
      }
    } catch (caught) {
      window.alert(caught instanceof Error ? caught.message : 'Could not move the note.')
    }
  }

  async function moveFolder(folder: string[], parent: string[]) {
    const activeId = router.state.location.pathname.match(/^\/notes\/([^/]+)$/)?.[1]
    const activeNote = vault.notes.find((note) => note.id === activeId)
    const movingActiveNote = activeNote?.folder.slice(0, folder.length).every((part, index) => part === folder[index]) ?? false
    try {
      await vault.moveFolder(folder, parent)
      if (movingActiveNote) await router.navigate({ to: '/' })
    } catch (caught) {
      window.alert(caught instanceof Error ? caught.message : 'Could not move the folder.')
    }
  }

  async function openSearch() {
    await router.navigate({ to: '/' })
    window.setTimeout(() => document.querySelector<HTMLInputElement>('[data-note-search]')?.focus(), 0)
  }

  return (
    <div className="min-h-screen min-w-80 bg-vault-50 font-sans text-[var(--text-normal)] [color-scheme:dark] min-[721px]:grid min-[721px]:grid-cols-[238px_1fr]">
      <aside className="z-10 flex h-[68px] w-full flex-row items-center justify-between border-b border-[var(--background-modifier-border)] bg-vault-100 px-[18px] min-[721px]:fixed min-[721px]:inset-y-0 min-[721px]:left-0 min-[721px]:h-auto min-[721px]:w-[238px] min-[721px]:flex-col min-[721px]:items-stretch min-[721px]:justify-start min-[721px]:border-r min-[721px]:border-b-0 min-[721px]:px-5 min-[721px]:pt-8 min-[721px]:pb-5">
        <Logo />
        <nav className="flex gap-1 min-[721px]:mb-5 min-[721px]:grid" aria-label="Vault actions">
          <SidebarAction disabled={creating} onClick={() => void createNote()}><Plus size={16} />New Note</SidebarAction>
           <SidebarAction disabled={creating} onClick={() => void createFolder()}><FolderPlus size={16} />New Folder</SidebarAction>
          <SidebarAction onClick={() => void openSearch()}><Search size={16} />Search</SidebarAction>
        </nav>
        <NoteTree
          notes={vault.notes.map(({ id, title, folder }) => ({ id, title, folder })) satisfies NoteNavigationItem[]}
          folders={vault.folders}
          onCreateNote={(folder) => void createNote(folder)}
          onCreateFolder={(folder) => void createFolder(folder)}
          onDeleteFolder={(folder) => void deleteFolder(folder)}
          onDeleteNote={(note) => void deleteNote(note)}
          onMoveNote={(id, folder) => void moveNote(id, folder)}
          onMoveFolder={(folder, parent) => void moveFolder(folder, parent)}
        />
      </aside>
      <main className="min-w-0 min-[721px]:col-start-2">{children}</main>
    </div>
  )
}
