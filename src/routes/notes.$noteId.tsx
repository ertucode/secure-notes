import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { ArrowLeft, Check, Clock3, ImagePlus, Save, Tag, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent, type ClipboardEvent } from 'react'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useVault } from '~/context/VaultContext'
import type { NoteColor } from '~/lib/notes.schemas'

export const Route = createFileRoute('/notes/$noteId')({
  head: () => ({ meta: [{ title: 'Encrypted note — Ciphernote' }] }),
  component: NoteEditor,
})

const MAX_IMAGE_SIZE = 5 * 1024 * 1024

function readImage(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`))
    reader.readAsDataURL(file)
  })
}

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
  const router = useRouter()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState(note?.title ?? '')
  const [content, setContent] = useState(note?.content ?? '')
  const [attachments, setAttachments] = useState<Record<string, string>>(note?.attachments ?? {})
  const [tags, setTags] = useState(note?.tags.join(', ') ?? '')
  const [color, setColor] = useState<NoteColor>(note?.color ?? 'mint')
  const [draggingImage, setDraggingImage] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!note) return
    const migrated = extractEmbeddedImages(note.content, note.attachments ?? {})
    setTitle(note.title)
    setContent(migrated.content)
    setAttachments(migrated.attachments)
    setTags(note.tags.join(', '))
    setColor(note.color)
  }, [note])

  const persist = useCallback(async () => {
    if (!note || saving) return
    setSaving(true)
    setSaved(false)
    setError('')
    try {
      const updated = await vault.saveNote({
        id: note.id,
        title: title || 'Untitled note',
        content,
        attachments,
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

  const resolveMarkdownUrl = useCallback((value: string) => {
    if (value.startsWith('attachment:')) return attachments[value.slice('attachment:'.length)] ?? ''
    if (/^data:image\/(?:avif|gif|jpeg|png|webp);base64,/i.test(value)) return value
    return defaultUrlTransform(value)
  }, [attachments])

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

  async function insertImages(files: File[]) {
    const images = files.filter((file) => file.type.startsWith('image/'))
    if (!images.length) return
    const oversized = images.find((file) => file.size > MAX_IMAGE_SIZE)
    if (oversized) {
      setError(`${oversized.name} is larger than 5 MB.`)
      return
    }
    setError('')
    try {
      const encoded = await Promise.all(images.map(readImage))
      const markdown = encoded.map((source, index) => {
        const fallback = `image-${index + 1}`
        const alt = (images[index].name || fallback).replace(/[\[\]\n\r]/g, ' ')
        const id = `image-${crypto.randomUUID()}`
        setAttachments((current) => ({ ...current, [id]: source }))
        return `![${alt}](attachment:${id})`
      }).join('\n\n')
      const textarea = textareaRef.current
      const start = textarea?.selectionStart ?? content.length
      const end = textarea?.selectionEnd ?? start
      const before = content.slice(0, start)
      const after = content.slice(end)
      const insertion = `${before && !before.endsWith('\n') ? '\n\n' : ''}${markdown}${after && !after.startsWith('\n') ? '\n\n' : ''}`
      const next = `${before}${insertion}${after}`
      const caret = before.length + insertion.length
      setContent(next)
      window.requestAnimationFrame(() => {
        textareaRef.current?.focus()
        textareaRef.current?.setSelectionRange(caret, caret)
      })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not add the image.')
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = [...event.clipboardData.items]
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null)
    if (!files.length) return
    event.preventDefault()
    void insertImages(files)
  }

  function handleDrop(event: DragEvent<HTMLTextAreaElement>) {
    event.preventDefault()
    setDraggingImage(false)
    void insertImages([...event.dataTransfer.files])
  }

  function chooseImages(event: ChangeEvent<HTMLInputElement>) {
    void insertImages([...(event.target.files ?? [])])
    event.target.value = ''
  }

  async function remove() {
    if (!note || !window.confirm('Delete this encrypted file from GitHub permanently?')) return
    try {
      await vault.deleteNote(note.id)
      await router.navigate({ to: '/' })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete this note.')
    }
  }

  if (!note) return <div className="message-page"><h1>Note not found</h1><p>This file may have been renamed or deleted on GitHub.</p><Link to="/" className="back-link">Back to notes</Link></div>

  return (
    <div className="editor-page">
      <header className="editor-header">
        <Link to="/" className="back-link"><ArrowLeft size={18} />Back to notes</Link>
        <div className="editor-actions">
          <span className="save-state">{saved ? <><Check size={15} />Encrypted and saved</> : <><Clock3 size={15} />⌘S to save</>}</span>
          <button className="icon-button bordered danger" onClick={() => void remove()} aria-label="Delete note"><Trash2 size={17} /></button>
          <button className="primary-button" disabled={saving} onClick={() => void persist()}><Save size={17} />{saving ? 'Encrypting…' : 'Save note'}</button>
        </div>
      </header>
      <div className="editor-canvas">
        <div className="editor-meta">
          <div className="color-picker" aria-label="Note color">{(['mint', 'lavender', 'peach', 'sky'] as NoteColor[]).map((value) => <button key={value} className={`color-dot ${value} ${color === value ? 'active' : ''}`} onClick={() => setColor(value)} aria-label={`${value} color`} />)}</div>
          <span>{note.path}</span>
        </div>
        {error && <p className="editor-error" role="alert">{error}</p>}
        <input className="title-input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Untitled note" maxLength={120} />
        <label className="tag-input"><Tag size={16} /><input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="Add tags, separated by commas" /></label>
        <div className="editor-rule" />
        <div className="markdown-toolbar">
          <span>Markdown</span>
          <button className="image-button" onClick={() => imageInputRef.current?.click()}><ImagePlus size={15} />Add image</button>
          <input ref={imageInputRef} className="visually-hidden" type="file" accept="image/*" multiple onChange={chooseImages} />
        </div>
        <div className="markdown-workspace">
          <section className="markdown-pane">
            <span className="pane-label">Write</span>
            <textarea
              ref={textareaRef}
              className={`content-input ${draggingImage ? 'dragging-image' : ''}`}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              onPaste={handlePaste}
              onDragEnter={(event) => { if (event.dataTransfer.types.includes('Files')) setDraggingImage(true) }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setDraggingImage(false)}
              onDrop={handleDrop}
              placeholder="Write Markdown, paste an image, or drop one here…"
              autoFocus
            />
          </section>
          <section className="markdown-pane preview-pane">
            <span className="pane-label">Preview</span>
            <article className="markdown-preview">
              {content ? <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={resolveMarkdownUrl}>{content}</ReactMarkdown> : <p className="markdown-empty">Nothing to preview yet.</p>}
            </article>
          </section>
        </div>
        <footer className="editor-footer"><span>{content.trim() ? content.trim().split(/\s+/).length : 0} words</span><span>{content.length} characters</span><span>Markdown · AES-256-GCM</span></footer>
      </div>
    </div>
  )
}
