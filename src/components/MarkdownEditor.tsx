import { defaultValueCtx, Editor, editorViewCtx, rootCtx, serializerCtx } from '@milkdown/kit/core'
import { Slice, Fragment, type Node as ProseNode, type Schema } from '@milkdown/kit/prose/model'
import { Decoration } from '@milkdown/kit/prose/view'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { upload, uploadConfig } from '@milkdown/kit/plugin/upload'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react'
import { ImagePlus } from 'lucide-react'
import { forwardRef, useEffect, useImperativeHandle, useRef, type ChangeEvent } from 'react'
import '@milkdown/kit/prose/view/style/prosemirror.css'
import '@milkdown/kit/prose/tables/style/tables.css'

const MAX_IMAGE_SIZE = 5 * 1024 * 1024

type Props = {
  value: string
  attachments: Record<string, string>
  onChange: (value: string, attachments: Record<string, string>) => void
  onError: (message: string) => void
}

export type MarkdownEditorHandle = {
  getValue: () => { value: string; attachments: Record<string, string> }
}

function hydrateImages(markdown: string, attachments: Record<string, string>) {
  return markdown.replace(
    /(!\[[^\]]*\]\()attachment:([^)\s]+)(\))/g,
    (match, opening: string, id: string, closing: string) => {
      const source = attachments[id]
      return source ? `${opening}${source}${closing}` : match
    },
  )
}

function extractImages(markdown: string, stored: Record<string, string>) {
  const attachments = { ...stored }
  const knownImages = new Map(Object.entries(attachments).map(([id, source]) => [source, id]))
  const value = markdown.replace(
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
  return { value, attachments }
}

function readImage(file: File) {
  return new Promise<{ alt: string; src: string }>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve({ alt: file.name.replace(/[\[\]\n\r]/g, ' '), src: String(reader.result) })
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`))
    reader.readAsDataURL(file)
  })
}

async function imageNodes(files: File[], schema: Schema, onError: Props['onError']) {
  const images = files.filter((file) => file.type.startsWith('image/'))
  const oversized = images.find((file) => file.size > MAX_IMAGE_SIZE)
  if (oversized) {
    const message = `${oversized.name} is larger than 5 MB.`
    onError(message)
    throw new Error(message)
  }
  if (!images.length) return []
  onError('')
  const encoded = await Promise.all(images.map(readImage))
  return encoded.map(({ alt, src }) => schema.nodes.image.create({ src, alt }))
}

const EditorSurface = forwardRef<MarkdownEditorHandle, Props>(function EditorSurface({ value, attachments, onChange, onError }, ref) {
  const inputRef = useRef<HTMLInputElement>(null)
  const attachmentsRef = useRef(attachments)
  const onChangeRef = useRef(onChange)
  const onErrorRef = useRef(onError)

  useEffect(() => { attachmentsRef.current = attachments }, [attachments])
  useEffect(() => { onChangeRef.current = onChange }, [onChange])
  useEffect(() => { onErrorRef.current = onError }, [onError])

  const { get, loading } = useEditor((root) => Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root)
      ctx.set(defaultValueCtx, hydrateImages(value, attachmentsRef.current))
      ctx.set(uploadConfig.key, {
        enableHtmlFileUploader: true,
        uploader: async (files, schema) => imageNodes([...files], schema, onErrorRef.current),
        uploadWidgetFactory: (pos, spec) => {
          const element = document.createElement('span')
          element.className = 'milkdown-image-loading'
          element.textContent = 'Adding image…'
          return Decoration.widget(pos, element, spec)
        },
      })
      ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
        const extracted = extractImages(markdown, attachmentsRef.current)
        attachmentsRef.current = extracted.attachments
        onChangeRef.current(extracted.value, extracted.attachments)
      })
    })
    .use(commonmark)
    .use(gfm)
    .use(listener)
    .use(upload))

  useImperativeHandle(ref, () => ({
    getValue: () => {
      const editor = get()
      if (!editor) return { value, attachments: attachmentsRef.current }
      return editor.action((ctx) => {
        const markdown = ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc)
        return extractImages(markdown, attachmentsRef.current)
      })
    },
  }), [get, value])

  async function chooseImages(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])]
    event.target.value = ''
    const editor = get()
    if (!editor || !files.length) return
    try {
      const nodes = await editor.action((ctx) => imageNodes(files, ctx.get(editorViewCtx).state.schema, onErrorRef.current))
      if (!nodes.length) return
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        const content = Fragment.fromArray(nodes as ProseNode[])
        view.dispatch(view.state.tr.replaceSelection(new Slice(content, 0, 0)).scrollIntoView())
        view.focus()
      })
    } catch (caught) {
      onErrorRef.current(caught instanceof Error ? caught.message : 'Could not add the image.')
    }
  }

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[9px] font-bold tracking-[0.1em] text-[var(--text-faint)] uppercase">Rich Markdown</span>
        <button className="inline-flex min-h-[31px] cursor-pointer items-center gap-1.5 rounded-md border-0 bg-transparent px-2.5 text-[10px] font-semibold text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)]" onClick={() => inputRef.current?.click()} type="button"><ImagePlus size={15} />Add image</button>
        <input ref={inputRef} className="sr-only" type="file" accept="image/*" multiple onChange={chooseImages} />
      </div>
      <div className="milkdown-editor min-h-[520px] rounded-md border border-[var(--background-modifier-border)] bg-[var(--background-primary)] px-5 py-4" aria-busy={loading}>
        <Milkdown />
      </div>
      <p className="mt-2.5 text-[9px] text-[var(--text-faint)]">Use Markdown shortcuts as you type, or paste and drop images directly into the note.</p>
    </>
  )
})

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, Props>(function MarkdownEditor(props, ref) {
  return <MilkdownProvider><EditorSurface ref={ref} {...props} /></MilkdownProvider>
})
