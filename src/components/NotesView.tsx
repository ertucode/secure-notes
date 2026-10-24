import { useNavigate, useRouter } from '@tanstack/react-router'
import { Grid2X2, List, LockKeyhole, Plus, RefreshCw, Search, SlidersHorizontal } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useVault } from '~/context/VaultContext'
import type { NoteFilters } from '~/lib/notes.schemas'
import { NoteCard } from './NoteCard'

type Props = { search: NoteFilters }

export function NotesView({ search }: Props) {
  const navigate = useNavigate({ from: '/' })
  const router = useRouter()
  const vault = useVault()
  const [creating, setCreating] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const tags = useMemo(() => [...new Set(vault.notes.flatMap((note) => note.tags))].sort(), [vault.notes])
  const notes = useMemo(() => {
    const query = search.q.trim().toLocaleLowerCase()
    return [...vault.notes]
      .filter((note) => (!query || `${note.title} ${note.content} ${note.tags.join(' ')}`.toLocaleLowerCase().includes(query)) && (search.tag === 'all' || note.tags.includes(search.tag)))
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
        if (search.sort === 'title') return a.title.localeCompare(b.title)
        return search.sort === 'created' ? b.createdAt.localeCompare(a.createdAt) : b.updatedAt.localeCompare(a.updatedAt)
      })
  }, [vault.notes, search])
  const setSearch = (next: Partial<NoteFilters>) => navigate({ search: (previous) => ({ ...previous, ...next }) })
  async function makeNote() {
    setCreating(true)
    try {
      const note = await vault.createNote()
      await router.navigate({ to: '/notes/$noteId', params: { noteId: note.id } })
    } finally { setCreating(false) }
  }
  return (
    <div className="page-wrap">
      <header className="page-header">
        <div><p className="eyebrow">Personal vault</p><h1>Your notes</h1><p className="subtitle">A calm space for thoughts, plans, and everything in between.</p></div>
        <div className="page-actions"><button className="icon-button bordered" disabled={refreshing} onClick={async () => { setRefreshing(true); try { await vault.refresh() } finally { setRefreshing(false) } }} aria-label="Refresh from GitHub"><RefreshCw size={17} className={refreshing ? 'spin' : ''} /></button><button className="icon-button bordered" onClick={vault.lock} aria-label="Lock vault"><LockKeyhole size={17} /></button><button className="primary-button" disabled={creating} onClick={makeNote}><Plus size={18} />{creating ? 'Creating…' : 'New note'}</button></div>
      </header>
      <section className="toolbar" aria-label="Notes controls">
        <label className="search-box"><Search size={18} /><input data-note-search value={search.q} onChange={(event) => setSearch({ q: event.target.value })} placeholder="Search your notes…" aria-label="Search notes" /><kbd>⌘ K</kbd></label>
        <button className={filtersOpen ? 'secondary-button selected' : 'secondary-button'} onClick={() => setFiltersOpen((value) => !value)}><SlidersHorizontal size={17} />Filter</button>
        <select className="select-control" value={search.sort} onChange={(event) => setSearch({ sort: event.target.value as NoteFilters['sort'] })} aria-label="Sort notes">
          <option value="updated">Recently edited</option><option value="created">Recently created</option><option value="title">Title</option>
        </select>
        <div className="view-toggle">
          <button className={search.view === 'grid' ? 'active' : ''} onClick={() => setSearch({ view: 'grid' })} aria-label="Grid view"><Grid2X2 size={16} /></button>
          <button className={search.view === 'list' ? 'active' : ''} onClick={() => setSearch({ view: 'list' })} aria-label="List view"><List size={17} /></button>
        </div>
      </section>
      {filtersOpen && <div className="filter-strip"><span>Show tag</span><button className={search.tag === 'all' ? 'active' : ''} onClick={() => setSearch({ tag: 'all' })}>All</button>{tags.map((tag) => <button key={tag} className={search.tag === tag ? 'active' : ''} onClick={() => setSearch({ tag })}>{tag}</button>)}</div>}
      <div className="section-heading"><h2>{search.q || search.tag !== 'all' ? 'Results' : 'Recent notes'}</h2><span>{notes.length} of {vault.notes.length}</span></div>
      {notes.length ? (
        <section className={search.view === 'grid' ? 'notes-grid' : 'notes-list'}>
          {notes.map((note) => <NoteCard key={note.id} note={note} list={search.view === 'list'} />)}
        </section>
      ) : (
        <div className="empty-state"><div className="empty-icon"><Search size={24} /></div><h2>{vault.notes.length ? 'No notes found' : 'Your vault is empty'}</h2><p>{vault.notes.length ? 'Try a different search or filter.' : 'Create your first encrypted note.'}</p></div>
      )}
    </div>
  )
}
