import { Link, useRouter } from '@tanstack/react-router'
import { Pin } from 'lucide-react'
import { useState } from 'react'
import { useVault } from '~/context/VaultContext'
import type { Note } from '~/lib/notes.schemas'

function relativeDate(value: string) {
  const days = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 86_400_000))
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return `${days} days ago`
}

function noteExcerpt(content: string) {
  return content
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_match, alt: string) => alt || '[Image]')
    .replace(/(?:^|\s)[#>*_~`-]+\s?/gm, ' ')
    .trim()
}

export function NoteCard({ note, list = false }: { note: Note; list?: boolean }) {
  const router = useRouter()
  const vault = useVault()
  const [busy, setBusy] = useState(false)
  async function togglePin() {
    setBusy(true)
    try {
      await vault.togglePin(note.id)
    } finally { setBusy(false) }
  }
  return (
    <article className={`note-card color-${note.color} ${list ? 'note-card-list' : ''}`}>
      <div className="note-card-top">
        <span className="note-date">Edited {relativeDate(note.updatedAt)}</span>
        <div className="card-actions">
          <button disabled={busy} className={note.pinned ? 'icon-button active' : 'icon-button'} onClick={togglePin} aria-label={note.pinned ? 'Unpin note' : 'Pin note'}><Pin size={15} fill={note.pinned ? 'currentColor' : 'none'} /></button>
        </div>
      </div>
      <Link to="/notes/$noteId" params={{ noteId: note.id }} className="note-link">
        <h2>{note.title}</h2>
        <p>{noteExcerpt(note.content) || 'This note is waiting for your thoughts.'}</p>
      </Link>
      <div className="tag-row">
        {note.tags.map((tag) => <span className="tag" key={tag}>{tag}</span>)}
      </div>
    </article>
  )
}
