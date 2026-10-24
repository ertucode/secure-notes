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
        <details className="tree-folder" open key={folder.path}>
          <summary className="tree-row" style={{ paddingLeft: `${8 + depth * 13}px` }}>
            <ChevronRight className="tree-chevron" size={12} />
            <Folder className="folder-closed" size={14} />
            <FolderOpen className="folder-open" size={14} />
            <span>{folder.name}</span>
          </summary>
          <TreeBranch node={folder} depth={depth + 1} />
        </details>
      ))}
      {notes.map((note) => (
        <Link
          className="tree-row tree-note"
          activeProps={{ className: 'tree-row tree-note active' }}
          key={note.id}
          params={{ noteId: note.id }}
          style={{ paddingLeft: `${25 + depth * 13}px` }}
          to="/notes/$noteId"
        >
          <FileText size={13} />
          <span>{note.title}</span>
        </Link>
      ))}
    </>
  )
}

export function NoteTree({ notes }: { notes: NoteNavigationItem[] }) {
  const tree = makeTree(notes)
  return (
    <div className="note-tree">
      <div className="tree-content">
        <TreeBranch node={tree} depth={0} />
      </div>
    </div>
  )
}
