import { Link, useRouter } from '@tanstack/react-router'
import { Pin } from 'lucide-react'
import { useState } from 'react'
import { useVault } from '~/context/VaultContext'
import type { Note } from '~/lib/notes.schemas'
import { IconButton, cn } from './ui'

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
    <article className={cn(
      'group relative flex min-h-[210px] flex-col overflow-hidden rounded-xl border border-[#e0e3da] bg-white px-[19px] pt-[18px] pb-4 shadow-[0_3px_12px_#3540300b] transition duration-200 before:absolute before:inset-x-0 before:top-0 before:h-[3px] before:opacity-80 hover:-translate-y-0.5 hover:shadow-[0_9px_25px_#35403012]',
      note.color === 'mint' && 'before:bg-[#8fba9b]', note.color === 'lavender' && 'before:bg-[#afa6c9]', note.color === 'peach' && 'before:bg-[#d8aa88]', note.color === 'sky' && 'before:bg-[#8eafbd]',
      list && 'grid min-h-[126px] grid-cols-[minmax(0,1fr)_auto]',
    )}>
      <div className={cn('flex h-6 items-center justify-between', list && 'col-span-full')}>
        <span className="text-[9px] text-[#999d95]">Edited {relativeDate(note.updatedAt)}</span>
        <div className="flex gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100">
          <IconButton disabled={busy} active={note.pinned} onClick={togglePin} aria-label={note.pinned ? 'Unpin note' : 'Pin note'}><Pin size={15} fill={note.pinned ? 'currentColor' : 'none'} /></IconButton>
        </div>
      </div>
      <Link to="/notes/$noteId" params={{ noteId: note.id }} className="flex-1 text-inherit no-underline">
        <h2 className="mt-3 mb-[9px] font-serif text-xl font-semibold tracking-[-0.25px]">{note.title}</h2>
        <p className={cn('m-0 line-clamp-4 overflow-hidden whitespace-pre-line font-serif text-xs leading-[1.65] text-[#6f746b]', list && 'line-clamp-2')}>{noteExcerpt(note.content) || 'This note is waiting for your thoughts.'}</p>
      </Link>
      <div className={cn('mt-[17px] flex min-h-[21px] flex-wrap gap-[5px]', list && 'min-w-[150px] content-end justify-end')}>
        {note.tags.map((tag) => <span className="rounded-[10px] bg-[#f0f1ed] px-2 py-1 text-[8px] font-semibold text-[#777c73]" key={tag}>{tag}</span>)}
      </div>
    </article>
  )
}
