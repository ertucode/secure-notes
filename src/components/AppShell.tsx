import { useRouter } from '@tanstack/react-router'
import { FolderPlus, Plus, Search } from 'lucide-react'
import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { useVault } from '~/context/VaultContext'
import { Logo } from './Logo'
import { NoteTree, type NoteNavigationItem } from './NoteTree'

type Props = { children: ReactNode }

function SidebarAction(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className="flex min-h-[38px] w-9 cursor-pointer items-center justify-center gap-[9px] rounded-lg border-0 bg-transparent p-0 text-left text-[0] font-medium text-[#62675e] hover:bg-[#e2e9df] hover:text-[#335241] disabled:cursor-wait disabled:opacity-55 min-[721px]:w-auto min-[721px]:justify-start min-[721px]:px-[11px] min-[721px]:text-xs [&_svg]:text-[#718276]" {...props} />
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
    <div className="min-h-screen min-w-80 bg-vault-50 font-sans text-[#252821] [color-scheme:light] min-[721px]:grid min-[721px]:grid-cols-[238px_1fr]">
      <aside className="z-10 flex h-[68px] w-full flex-row items-center justify-between border-b border-[#e3e5dc] bg-vault-100 px-[18px] min-[721px]:fixed min-[721px]:inset-y-0 min-[721px]:left-0 min-[721px]:h-auto min-[721px]:w-[238px] min-[721px]:flex-col min-[721px]:items-stretch min-[721px]:justify-start min-[721px]:border-r min-[721px]:border-b-0 min-[721px]:border-r-[#e2e4dc] min-[721px]:px-5 min-[721px]:pt-8 min-[721px]:pb-5">
        <Logo />
        <nav className="flex gap-1 min-[721px]:mb-5 min-[721px]:grid" aria-label="Vault actions">
          <SidebarAction disabled={creating} onClick={() => void createNote()}><Plus size={16} />New Note</SidebarAction>
          <SidebarAction disabled={creating} onClick={() => void createFolder()}><FolderPlus size={16} />New Folder</SidebarAction>
          <SidebarAction onClick={() => void openSearch()}><Search size={16} />Search</SidebarAction>
        </nav>
        <NoteTree notes={vault.notes.map(({ id, title, folder }) => ({ id, title, folder })) satisfies NoteNavigationItem[]} />
      </aside>
      <main className="min-w-0 min-[721px]:col-start-2">{children}</main>
    </div>
  )
}
