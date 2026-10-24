import { useNavigate, useRouter } from '@tanstack/react-router'
import { Grid2X2, List, LockKeyhole, Plus, RefreshCw, Search, SlidersHorizontal } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useVault } from '~/context/VaultContext'
import type { NoteFilters } from '~/lib/notes.schemas'
import { NoteCard } from './NoteCard'
import { IconButton, PrimaryButton, cn } from './ui'

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
      const { note, persisted } = vault.createNote()
      void persisted.catch((caught) => {
        window.alert(caught instanceof Error ? caught.message : 'Could not create the note. Your draft is still open; saving will retry.')
      })
      await router.navigate({ to: '/notes/$noteId', params: { noteId: note.id } })
    } finally { setCreating(false) }
  }
  return (
    <div className="mx-auto w-[calc(100%-30px)] pt-[35px] pb-20 min-[721px]:w-[calc(100%-48px)] min-[721px]:pt-[63px] min-[981px]:w-[min(1160px,calc(100%-80px))]">
      <header className="flex items-start justify-between gap-[30px]">
        <div><p className="m-0 mb-[9px] text-[10px] font-bold tracking-[0.13em] text-[var(--text-accent)] uppercase">Personal vault</p><h1 className="m-0 font-serif text-[38px] leading-none font-semibold tracking-[-1.3px] min-[721px]:text-[clamp(36px,4vw,48px)]">Your notes</h1><p className="mt-[13px] mb-0 max-w-[280px] text-[13px] text-[var(--text-muted)] min-[721px]:max-w-none">A calm space for thoughts, plans, and everything in between.</p></div>
        <div className="flex items-center gap-2 max-[520px]:[&>button:not(:last-child)]:hidden"><IconButton bordered disabled={refreshing} onClick={async () => { setRefreshing(true); try { await vault.refresh() } finally { setRefreshing(false) } }} aria-label="Refresh from GitHub"><RefreshCw size={17} className={refreshing ? 'animate-spin' : ''} /></IconButton><IconButton bordered onClick={vault.lock} aria-label="Lock vault"><LockKeyhole size={17} /></IconButton><PrimaryButton disabled={creating} onClick={makeNote}><Plus size={18} />{creating ? 'Creating…' : 'New note'}</PrimaryButton></div>
      </header>
      <section className="mt-[39px] flex flex-wrap items-center gap-[9px] min-[721px]:flex-nowrap" aria-label="Notes controls">
        <label className="flex min-h-10 basis-full items-center gap-2.5 rounded-md border border-[var(--background-modifier-border)] bg-[var(--background-modifier-form-field)] px-3 text-[var(--text-faint)] focus-within:border-[var(--interactive-accent)] focus-within:shadow-[0_0_0_2px_#7f6df240] min-[721px]:basis-auto min-[721px]:flex-1"><Search size={18} /><input className="min-w-0 flex-1 border-0 bg-transparent text-xs text-[var(--text-normal)] outline-0 placeholder:text-[var(--text-faint)]" data-note-search value={search.q} onChange={(event) => setSearch({ q: event.target.value })} placeholder="Search your notes…" aria-label="Search notes" /><kbd className="rounded border border-[var(--background-modifier-border)] bg-[var(--background-primary-alt)] px-[7px] py-[3px] font-sans text-[9px] text-[var(--text-faint)]">⌘ K</kbd></label>
        <button className={cn('inline-flex min-h-[39px] cursor-pointer items-center justify-center gap-[7px] rounded-md border border-[var(--background-modifier-border)] bg-[var(--background-primary-alt)] px-[13px] text-[11px] font-medium text-[var(--text-muted)] transition duration-150 hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)]', filtersOpen && 'bg-[var(--background-modifier-active-hover)] text-[var(--text-normal)]')} onClick={() => setFiltersOpen((value) => !value)}><SlidersHorizontal size={17} />Filter</button>
        <select className="h-[39px] rounded-md border border-[var(--background-modifier-border)] bg-[var(--background-primary-alt)] pr-[31px] pl-3 text-[11px] text-[var(--text-muted)] outline-0" value={search.sort} onChange={(event) => setSearch({ sort: event.target.value as NoteFilters['sort'] })} aria-label="Sort notes">
          <option value="updated">Recently edited</option><option value="created">Recently created</option><option value="title">Title</option>
        </select>
        <div className="flex rounded-md border border-[var(--background-modifier-border)] bg-[var(--background-primary-alt)] p-[3px]">
          <button className={cn('grid size-[31px] cursor-pointer place-items-center rounded border-0 bg-transparent text-[var(--text-faint)]', search.view === 'grid' && 'bg-[var(--background-modifier-active-hover)] text-[var(--text-accent)]')} onClick={() => setSearch({ view: 'grid' })} aria-label="Grid view"><Grid2X2 size={16} /></button>
          <button className={cn('grid size-[31px] cursor-pointer place-items-center rounded border-0 bg-transparent text-[var(--text-faint)]', search.view === 'list' && 'bg-[var(--background-modifier-active-hover)] text-[var(--text-accent)]')} onClick={() => setSearch({ view: 'list' })} aria-label="List view"><List size={17} /></button>
        </div>
      </section>
      {filtersOpen && <div className="mt-3 flex items-center gap-[7px] rounded-md border border-[var(--background-modifier-border)] bg-[var(--background-primary-alt)] px-3 py-2.5"><span className="mr-[3px] text-[10px] font-semibold tracking-[0.08em] text-[var(--text-muted)] uppercase">Show tag</span><button className={cn('cursor-pointer rounded-[13px] border-0 bg-[var(--background-modifier-hover)] px-2.5 py-[5px] text-[10px] text-[var(--text-muted)]', search.tag === 'all' && 'bg-vault-500 text-white')} onClick={() => setSearch({ tag: 'all' })}>All</button>{tags.map((tag) => <button key={tag} className={cn('cursor-pointer rounded-[13px] border-0 bg-[var(--background-modifier-hover)] px-2.5 py-[5px] text-[10px] text-[var(--text-muted)]', search.tag === tag && 'bg-vault-500 text-white')} onClick={() => setSearch({ tag })}>{tag}</button>)}</div>}
      <div className="mt-[35px] mb-4 flex items-center justify-between"><h2 className="m-0 font-serif text-xl font-semibold">{search.q || search.tag !== 'all' ? 'Results' : 'Recent notes'}</h2><span className="text-[10px] text-[var(--text-faint)]">{notes.length} of {vault.notes.length}</span></div>
      {notes.length ? (
        <section className={search.view === 'grid' ? 'grid grid-cols-1 gap-3.5 min-[721px]:grid-cols-2 min-[981px]:grid-cols-3' : 'grid gap-2.5'}>
          {notes.map((note) => <NoteCard key={note.id} note={note} list={search.view === 'list'} />)}
        </section>
      ) : (
        <div className="grid place-items-center rounded-lg border border-dashed border-[var(--background-modifier-border)] px-5 py-[70px] text-center"><div className="grid size-12 place-items-center rounded-full bg-[var(--background-modifier-hover)] text-[var(--text-muted)]"><Search size={24} /></div><h2 className="mt-[13px] mb-[3px] font-serif text-xl font-semibold">{vault.notes.length ? 'No notes found' : 'Your vault is empty'}</h2><p className="m-0 text-xs text-[var(--text-muted)]">{vault.notes.length ? 'Try a different search or filter.' : 'Create your first encrypted note.'}</p></div>
      )}
    </div>
  )
}
