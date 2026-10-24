import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { ArrowLeft, Check, Clock3, Save, Tag, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useVault } from '~/context/VaultContext'
import type { Note, NoteColor } from '~/lib/notes.schemas'
import { IconButton, MessagePage, PrimaryButton, backLinkClasses, cn } from '~/components/ui'
import { MarkdownEditor, type MarkdownEditorHandle } from '~/components/MarkdownEditor'

export const Route = createFileRoute('/notes/$noteId')({
  head: () => ({ meta: [{ title: 'Encrypted note — Ciphernote' }] }),
  component: NoteEditor,
})

function extractEmbeddedImages(content: string, stored: Record<string, string>) {
  const attachments = { ...stored }
  const knownImages = new Map(Object.entries(attachments).map(([id, source]) => [source, id]))
  const nextContent = content.replace(
    /!\[([^\]]*)\]\((data:image\/(?:avif|gif|jpeg|png|webp);base64,[A-Za-z0-9+/=]+)\)/gi,
    (_match, alt: string, source: string) => {
      let id = knownImages.get(source)
      if (!id) {
        id = `image-${crypto.randomUUID()}`
        attachments[id] = source
        knownImages.set(source, id)
      }
      return `![${alt}](attachment:${id})`
    },
  )
  return { content: nextContent, attachments }
}

function NoteEditor() {
  const { noteId } = Route.useParams()
  const vault = useVault()
  const note = vault.notes.find((item) => item.id === noteId)

  if (!note) return <MessagePage title="Note not found" action={<Link to="/" className={backLinkClasses}>Back to notes</Link>}>This file may have been renamed or deleted on GitHub.</MessagePage>

  // A route change must create fresh form and Milkdown state. Without this
  // boundary, the new editor can initialize from the previous note's state
  // before an effect has a chance to synchronize it.
  return <NoteEditorForm key={note.id} note={note} />
}

function NoteEditorForm({ note }: { note: Note }) {
  const vault = useVault()
  const router = useRouter()
  const editorRef = useRef<MarkdownEditorHandle>(null)
  const initial = extractEmbeddedImages(note.content, note.attachments ?? {})
  const [title, setTitle] = useState(note.title)
  const [content, setContent] = useState(initial.content)
  const [attachments, setAttachments] = useState<Record<string, string>>(initial.attachments)
  const [tags, setTags] = useState(note.tags.join(', '))
  const [color, setColor] = useState<NoteColor>(note.color)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const persist = useCallback(async () => {
    if (saving) return
    setSaving(true)
    setSaved(false)
    setError('')
    try {
      const currentEditor = editorRef.current?.getValue()
      const updated = await vault.saveNote({
        id: note.id,
        title: title || 'Untitled note',
        content: currentEditor?.value ?? content,
        attachments: currentEditor?.attachments ?? attachments,
        color,
        folder: note.folder,
        tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
      })
      if (updated.id !== note.id) {
        await router.navigate({ to: '/notes/$noteId', params: { noteId: updated.id }, replace: true })
      }
      setSaved(true)
      window.setTimeout(() => setSaved(false), 1800)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save this note.')
    } finally {
      setSaving(false)
    }
  }, [attachments, color, content, note, router, saving, tags, title, vault])

  useEffect(() => {
    function saveShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 's') {
        event.preventDefault()
        void persist()
      }
    }
    window.addEventListener('keydown', saveShortcut)
    return () => window.removeEventListener('keydown', saveShortcut)
  }, [persist])

  async function remove() {
    if (!window.confirm('Delete this encrypted file from GitHub permanently?')) return
    try {
      await vault.deleteNote(note.id)
      await router.navigate({ to: '/' })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete this note.')
    }
  }

  return (
    <div className="min-h-screen bg-[#f8f8f4]">
      <header className="flex min-h-[72px] items-center justify-between border-b border-[#e3e5dc] bg-white px-4 py-3 min-[721px]:h-[72px] min-[721px]:px-[38px] min-[721px]:py-0">
        <Link to="/" className={backLinkClasses}><ArrowLeft size={18} />Back to notes</Link>
        <div className="flex items-center gap-2">
          <span className="mr-2 hidden items-center gap-[5px] text-[9px] text-[#969b92] min-[981px]:inline-flex">{saved ? <><Check size={15} />Encrypted and saved</> : <><Clock3 size={15} />⌘S to save</>}</span>
          <IconButton className="max-[720px]:hidden" bordered danger onClick={() => void remove()} aria-label="Delete note"><Trash2 size={17} /></IconButton>
          <PrimaryButton disabled={saving} onClick={() => void persist()}><Save size={17} />{saving ? 'Encrypting…' : 'Save note'}</PrimaryButton>
        </div>
      </header>
      <div className="mx-auto mt-2.5 min-h-[calc(100vh-120px)] w-[calc(100%-20px)] rounded-t-sm border border-[#e5e5de] bg-white px-6 pt-7 pb-6 shadow-[0_8px_35px_#343c3010] min-[721px]:mt-[34px] min-[721px]:w-[min(1180px,calc(100%-80px))] min-[721px]:px-[42px] min-[721px]:pt-8">
        <div className="flex items-center justify-between text-[9px] text-[#a0a39d]">
          <div className="flex gap-1.5" aria-label="Note color">{(['mint', 'lavender', 'peach', 'sky'] as NoteColor[]).map((value) => <button key={value} className={cn('size-[13px] cursor-pointer rounded-full border-2 border-white p-0 outline outline-1 outline-transparent', value === 'mint' && 'bg-[#8fba9b]', value === 'lavender' && 'bg-[#afa6c9]', value === 'peach' && 'bg-[#d8aa88]', value === 'sky' && 'bg-[#8eafbd]', color === value && 'outline-[#849083]')} onClick={() => setColor(value)} aria-label={`${value} color`} />)}</div>
          <span>{note.path}</span>
        </div>
        {error && <p className="mt-[18px] mb-[-10px] rounded-[7px] bg-[#fff1ef] px-[11px] py-[9px] text-[11px] text-[#954841]" role="alert">{error}</p>}
        <input className="mt-[30px] w-full border-0 bg-transparent p-0 font-serif text-[34px] font-medium tracking-[-1px] text-[#252821] outline-0 placeholder:text-[#c1c3bd] min-[721px]:text-[42px]" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Untitled note" maxLength={120} />
        <label className="mt-[18px] flex items-center gap-2 text-[#8d9389]"><Tag size={16} /><input className="w-full border-0 bg-transparent p-0 text-[10px] text-[#757a72] outline-0" value={tags} onChange={(event) => setTags(event.target.value)} placeholder="Add tags, separated by commas" /></label>
        <div className="my-[25px] h-px bg-[#ecece7]" />
        <MarkdownEditor
          key={note.id}
          ref={editorRef}
          value={content}
          attachments={attachments}
          onChange={(value, nextAttachments) => { setContent(value); setAttachments(nextAttachments) }}
          onError={setError}
        />
        <footer className="flex gap-[15px] border-t border-[#eee] pt-[15px] text-[9px] text-[#a0a49c]"><span>{content.trim() ? content.trim().split(/\s+/).length : 0} words</span><span>{content.length} characters</span><span>Markdown · AES-256-GCM</span></footer>
      </div>
    </div>
  )
}
