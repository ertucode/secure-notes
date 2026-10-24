import { Link } from '@tanstack/react-router'
import { ChevronRight, FilePlus, FileText, Folder, FolderOpen, FolderPlus, Trash2 } from 'lucide-react'
import { useEffect, useState, type DragEvent, type MouseEvent, type ReactNode } from 'react'

export type NoteNavigationItem = {
  id: string
  title: string
  folder: string[]
}

type TreeNode = {
  name: string
  path: string
  folders: Map<string, TreeNode>
  notes: NoteNavigationItem[]
}

type ContextTarget =
  | { kind: 'folder'; path: string[] }
  | { kind: 'note'; note: NoteNavigationItem }

type ContextMenu = ContextTarget & { x: number; y: number }

type Props = {
  notes: NoteNavigationItem[]
  folders: string[][]
  onCreateNote: (folder: string[]) => void
  onCreateFolder: (folder: string[]) => void
  onDeleteFolder: (folder: string[]) => void
  onDeleteNote: (note: NoteNavigationItem) => void
  onMoveNote: (id: string, folder: string[]) => void
  onMoveFolder: (folder: string[], parent: string[]) => void
  onNavigate?: () => void
}

type DragItem =
  | { kind: 'note'; id: string }
  | { kind: 'folder'; path: string[] }

const dragType = 'application/x-ciphernote-tree-item'

function addFolder(root: TreeNode, pathParts: string[]) {
  let node = root
  for (const segment of pathParts) {
    const path = node.path ? `${node.path}/${segment}` : segment
    let child = node.folders.get(segment)
    if (!child) {
      child = { name: segment, path, folders: new Map(), notes: [] }
      node.folders.set(segment, child)
    }
    node = child
  }
  return node
}

function makeTree(notes: NoteNavigationItem[], folders: string[][]) {
  const root: TreeNode = { name: '', path: '', folders: new Map(), notes: [] }
  for (const folder of folders) addFolder(root, folder)
  for (const note of notes) addFolder(root, note.folder).notes.push(note)
  return root
}

function TreeBranch({ node, depth, openMenu, dropTarget, startDrag, dragOver, drop }: {
  node: TreeNode
  depth: number
  openMenu: (event: MouseEvent, target: ContextTarget) => void
  dropTarget: string | null
  startDrag: (event: DragEvent, item: DragItem) => void
  dragOver: (event: DragEvent, folder: string[]) => void
  drop: (event: DragEvent, folder: string[]) => void
}) {
  const folders = [...node.folders.values()].sort((a, b) => a.name.localeCompare(b.name))
  const notes = [...node.notes].sort((a, b) => a.title.localeCompare(b.title))
  return (
    <>
      {folders.map((folder) => (
        <details className="group/folder my-px" open key={folder.path}>
          <summary
            className={`flex min-h-10 w-full cursor-pointer list-none items-center gap-2 overflow-hidden rounded-lg text-[13px] font-medium text-[var(--text-muted)] select-none hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)] min-[721px]:min-h-[29px] min-[721px]:gap-1.5 min-[721px]:rounded-md min-[721px]:text-[10px] [&::-webkit-details-marker]:hidden ${dropTarget === folder.path ? 'bg-[var(--background-modifier-active-hover)] text-[var(--text-accent)]' : ''}`}
            style={{ paddingLeft: `${8 + depth * 13}px` }}
            onContextMenu={(event) => openMenu(event, { kind: 'folder', path: folder.path.split('/') })}
            draggable
            onDragStart={(event) => startDrag(event, { kind: 'folder', path: folder.path.split('/') })}
            onDragOver={(event) => dragOver(event, folder.path.split('/'))}
            onDrop={(event) => drop(event, folder.path.split('/'))}
          >
            <ChevronRight className="shrink-0 text-[var(--text-faint)] transition-transform duration-150 group-open/folder:rotate-90" size={12} />
            <Folder className="shrink-0 text-[var(--text-muted)] group-open/folder:hidden" size={14} />
            <FolderOpen className="hidden shrink-0 text-[var(--text-muted)] group-open/folder:block" size={14} />
            <span className="overflow-hidden text-ellipsis whitespace-nowrap">{folder.name}</span>
          </summary>
          <TreeBranch node={folder} depth={depth + 1} openMenu={openMenu} dropTarget={dropTarget} startDrag={startDrag} dragOver={dragOver} drop={drop} />
        </details>
      ))}
      {notes.map((note) => (
        <Link
          className="flex min-h-10 w-full cursor-pointer items-center gap-2 overflow-hidden rounded-lg text-[13px] font-medium text-[var(--text-muted)] no-underline select-none hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)] min-[721px]:min-h-[29px] min-[721px]:gap-1.5 min-[721px]:rounded-md min-[721px]:text-[10px] [&_svg]:shrink-0 [&_svg]:text-[var(--text-faint)]"
          activeProps={{ className: 'bg-[var(--background-modifier-active-hover)] font-semibold text-[var(--text-normal)] [&_svg]:text-[var(--text-accent)]' }}
          key={note.id}
          params={{ noteId: note.id }}
          style={{ paddingLeft: `${25 + depth * 13}px` }}
          to="/notes/$noteId"
          onContextMenu={(event) => openMenu(event, { kind: 'note', note })}
          draggable
          onDragStart={(event) => startDrag(event, { kind: 'note', id: note.id })}
        >
          <FileText size={13} />
          <span className="overflow-hidden text-ellipsis whitespace-nowrap">{note.title}</span>
        </Link>
      ))}
    </>
  )
}

export function NoteTree({ notes, folders, onCreateNote, onCreateFolder, onDeleteFolder, onDeleteNote, onMoveNote, onMoveFolder, onNavigate }: Props) {
  const [menu, setMenu] = useState<ContextMenu | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const tree = makeTree(notes, folders)

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [menu])

  function openMenu(event: MouseEvent, target: ContextTarget) {
    event.preventDefault()
    event.stopPropagation()
    setMenu({ ...target, x: Math.min(event.clientX, window.innerWidth - 170), y: Math.min(event.clientY, window.innerHeight - 118) })
  }

  function run(action: () => void) {
    setMenu(null)
    action()
  }

  function startDrag(event: DragEvent, item: DragItem) {
    event.stopPropagation()
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(dragType, JSON.stringify(item))
  }

  function dragOver(event: DragEvent, folder: string[]) {
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    setDropTarget(folder.join('/'))
  }

  function drop(event: DragEvent, folder: string[]) {
    event.preventDefault()
    event.stopPropagation()
    setDropTarget(null)
    try {
      const item = JSON.parse(event.dataTransfer.getData(dragType)) as DragItem
      if (item.kind === 'note') onMoveNote(item.id, folder)
      else if (item.kind === 'folder') onMoveFolder(item.path, folder)
    } catch {
      // Ignore drags originating outside the note tree.
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      <div
        className={`h-full max-h-full overflow-y-auto rounded-md pr-0.5 [scrollbar-color:#4a4a4a_transparent] [scrollbar-width:thin] ${dropTarget === '' ? 'bg-[var(--background-modifier-hover)]' : ''}`}
        onDragOver={(event) => dragOver(event, [])}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null)
        }}
        onDrop={(event) => drop(event, [])}
        onDragEnd={() => setDropTarget(null)}
      >
        <div onClick={(event) => {
          if ((event.target as HTMLElement).closest('a')) onNavigate?.()
        }}>
          <TreeBranch node={tree} depth={0} openMenu={openMenu} dropTarget={dropTarget} startDrag={startDrag} dragOver={dragOver} drop={drop} />
        </div>
        {!notes.length && !folders.length && <p className="px-2 py-8 text-center text-xs leading-5 text-[var(--text-faint)]">No notes yet.<br />Create one to get started.</p>}
      </div>
      {menu && (
        <div
          className="fixed z-50 min-w-40 rounded-md border border-[var(--background-modifier-border)] bg-[var(--background-primary-alt)] p-1 shadow-xl"
          style={{ left: menu.x, top: menu.y }}
          role="menu"
          onMouseDown={(event) => event.stopPropagation()}
        >
          {menu.kind === 'folder' ? (
            <>
              <MenuItem icon={<FolderPlus size={14} />} onClick={() => run(() => onCreateFolder(menu.path))}>New Folder</MenuItem>
              <MenuItem icon={<FilePlus size={14} />} onClick={() => run(() => onCreateNote(menu.path))}>New Note</MenuItem>
              <MenuItem danger icon={<Trash2 size={14} />} onClick={() => run(() => onDeleteFolder(menu.path))}>Delete Folder</MenuItem>
            </>
          ) : (
            <MenuItem danger icon={<Trash2 size={14} />} onClick={() => run(() => onDeleteNote(menu.note))}>Delete Note</MenuItem>
          )}
        </div>
      )}
    </div>
  )
}

function MenuItem({ children, icon, danger, onClick }: {
  children: string
  icon: ReactNode
  danger?: boolean
  onClick: () => void
}) {
  return (
    <button
      className={`flex w-full cursor-pointer items-center gap-2 rounded px-2.5 py-2 text-left text-[11px] ${danger ? 'text-[var(--text-error)] hover:bg-[#3d2526]' : 'text-[var(--text-normal)] hover:bg-[var(--background-modifier-hover)]'}`}
      role="menuitem"
      onClick={onClick}
    >
      {icon}{children}
    </button>
  )
}
