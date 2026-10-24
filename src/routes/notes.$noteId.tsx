import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { ArrowLeft, Check, Clock3, ImagePlus, Save, Tag, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent, type ClipboardEvent } from 'react'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useVault } from '~/context/VaultContext'
import type { NoteColor } from '~/lib/notes.schemas'
import { IconButton, MessagePage, PrimaryButton, backLinkClasses, cn } from '~/components/ui'

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

  if (!note) return <MessagePage title="Note not found" action={<Link to="/" className={backLinkClasses}>Back to notes</Link>}>This file may have been renamed or deleted on GitHub.</MessagePage>

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
        <div className="mt-[-10px] mb-4 flex items-center justify-between">
          <span className="text-[9px] font-bold tracking-[0.1em] text-[#959a91] uppercase">Markdown</span>
          <button className="inline-flex min-h-[31px] cursor-pointer items-center gap-1.5 rounded-md border-0 bg-transparent px-2.5 text-[10px] font-semibold text-[#7d8279] hover:bg-[#eef2eb] hover:text-[#3f5949]" onClick={() => imageInputRef.current?.click()}><ImagePlus size={15} />Add image</button>
          <input ref={imageInputRef} className="sr-only" type="file" accept="image/*" multiple onChange={chooseImages} />
        </div>
        <div className="grid min-h-[520px] grid-cols-1 overflow-hidden rounded-[9px] border border-[#e5e7e0] min-[721px]:grid-cols-2">
          <section className="flex min-w-0 flex-col px-4 pt-3.5">
            <span className="block border-b border-[#eceee8] pb-[11px] text-[9px] font-bold tracking-[0.1em] text-[#959a91] uppercase">Write</span>
            <textarea
              ref={textareaRef}
              className={cn('min-h-[45vh] w-full flex-1 resize-none rounded-lg border border-dashed border-transparent bg-transparent py-3.5 font-mono text-[13px] leading-[1.7] text-[#474b44] outline-0 transition duration-150 placeholder:text-[#c1c3bd] min-[721px]:min-h-[480px]', draggingImage && 'border-[#7f9b83] bg-[#f2f7f0] shadow-[inset_0_0_0_3px_#55775d12]')}
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
          <section className="flex min-w-0 flex-col border-t border-[#e5e7e0] bg-[#fbfcfa] px-4 pt-3.5 min-[721px]:border-t-0 min-[721px]:border-l">
            <span className="block border-b border-[#eceee8] pb-[11px] text-[9px] font-bold tracking-[0.1em] text-[#959a91] uppercase">Preview</span>
            <article className="min-h-[35vh] [overflow-wrap:anywhere] py-3.5 font-serif text-base leading-[1.75] text-[#474b44] min-[721px]:min-h-[480px] [&>:first-child]:!mt-0 [&_a]:text-[#3f6b50] [&_blockquote]:mb-[1em] [&_blockquote]:border-l-[3px] [&_blockquote]:border-[#b9c9b9] [&_blockquote]:pl-4 [&_blockquote]:text-[#737a71] [&_code]:rounded-sm [&_code]:bg-[#f0f2ed] [&_code]:px-[5px] [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.82em] [&_h1]:my-[0.5em] [&_h1]:mt-[1.35em] [&_h1]:font-serif [&_h1]:text-[32px] [&_h1]:leading-[1.2] [&_h1]:text-[#292d27] [&_h2]:my-[0.5em] [&_h2]:mt-[1.35em] [&_h2]:font-serif [&_h2]:text-[25px] [&_h2]:leading-[1.2] [&_h2]:text-[#292d27] [&_h3]:my-[0.5em] [&_h3]:mt-[1.35em] [&_h3]:font-serif [&_h3]:text-xl [&_h3]:leading-[1.2] [&_h3]:text-[#292d27] [&_img]:mx-auto [&_img]:my-5 [&_img]:block [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-lg [&_input[type='checkbox']]:mr-1.5 [&_ol]:mb-[1em] [&_p]:mb-[1em] [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-[#f0f2ed] [&_pre]:p-3.5 [&_pre_code]:p-0 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-[#dde1d8] [&_td]:px-[9px] [&_td]:py-[7px] [&_td]:text-left [&_th]:border [&_th]:border-[#dde1d8] [&_th]:px-[9px] [&_th]:py-[7px] [&_th]:text-left [&_ul]:mb-[1em]">
              {content ? <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={resolveMarkdownUrl}>{content}</ReactMarkdown> : <p className="text-[#aaaea6]">Nothing to preview yet.</p>}
            </article>
          </section>
        </div>
        <footer className="flex gap-[15px] border-t border-[#eee] pt-[15px] text-[9px] text-[#a0a49c]"><span>{content.trim() ? content.trim().split(/\s+/).length : 0} words</span><span>{content.length} characters</span><span>Markdown · AES-256-GCM</span></footer>
      </div>
    </div>
  )
}
