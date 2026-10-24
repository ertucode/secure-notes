import { Link } from '@tanstack/react-router'
import { ChevronRight, FileText, Folder, FolderOpen } from 'lucide-react'

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

function makeTree(notes: NoteNavigationItem[]) {
  const root: TreeNode = { name: '', path: '', folders: new Map(), notes: [] }
  for (const note of notes) {
    let node = root
    for (const segment of note.folder) {
      const path = node.path ? `${node.path}/${segment}` : segment
      let child = node.folders.get(segment)
      if (!child) {
        child = { name: segment, path, folders: new Map(), notes: [] }
        node.folders.set(segment, child)
      }
      node = child
    }
    node.notes.push(note)
  }
  return root
}

function TreeBranch({ node, depth }: { node: TreeNode; depth: number }) {
  const folders = [...node.folders.values()].sort((a, b) => a.name.localeCompare(b.name))
  const notes = [...node.notes].sort((a, b) => a.title.localeCompare(b.title))
  return (
    <>
      {folders.map((folder) => (
        <details className="group/folder my-px" open key={folder.path}>
          <summary className="flex min-h-[29px] w-full cursor-pointer list-none items-center gap-1.5 overflow-hidden rounded-md text-[10px] font-medium text-[#747970] select-none hover:bg-[#e7eae3] hover:text-[#3f5647] [&::-webkit-details-marker]:hidden" style={{ paddingLeft: `${8 + depth * 13}px` }}>
            <ChevronRight className="shrink-0 text-[#a0a49c] transition-transform duration-150 group-open/folder:rotate-90" size={12} />
            <Folder className="shrink-0 text-[#758a78] group-open/folder:hidden" size={14} />
            <FolderOpen className="hidden shrink-0 text-[#758a78] group-open/folder:block" size={14} />
            <span className="overflow-hidden text-ellipsis whitespace-nowrap">{folder.name}</span>
          </summary>
          <TreeBranch node={folder} depth={depth + 1} />
        </details>
      ))}
      {notes.map((note) => (
        <Link
          className="flex min-h-[29px] w-full cursor-pointer items-center gap-1.5 overflow-hidden rounded-md text-[10px] font-medium text-[#7f837b] no-underline select-none hover:bg-[#e7eae3] hover:text-[#3f5647] [&_svg]:shrink-0 [&_svg]:text-[#a1a59d]"
          activeProps={{ className: 'bg-[#dfe8df] font-semibold text-[#345440] [&_svg]:text-[#52715b]' }}
          key={note.id}
          params={{ noteId: note.id }}
          style={{ paddingLeft: `${25 + depth * 13}px` }}
          to="/notes/$noteId"
        >
          <FileText size={13} />
          <span className="overflow-hidden text-ellipsis whitespace-nowrap">{note.title}</span>
        </Link>
      ))}
    </>
  )
}

export function NoteTree({ notes }: { notes: NoteNavigationItem[] }) {
  const tree = makeTree(notes)
  return (
    <div className="hidden min-h-0 flex-1 overflow-hidden min-[721px]:block">
      <div className="max-h-full overflow-y-auto pr-0.5 [scrollbar-color:#cfd4cb_transparent] [scrollbar-width:thin]">
        <TreeBranch node={tree} depth={0} />
      </div>
    </div>
  )
}
