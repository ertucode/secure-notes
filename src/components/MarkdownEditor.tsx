import { defaultKeymap, indentWithTab } from '@codemirror/commands'
import { LanguageDescription, LanguageSupport, StreamLanguage } from '@codemirror/language'
import { oneDark } from '@codemirror/theme-one-dark'
import { keymap } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { defaultValueCtx, Editor, editorViewCtx, rootCtx, serializerCtx } from '@milkdown/kit/core'
import { codeBlockComponent, codeBlockConfig } from '@milkdown/kit/component/code-block'
import { tableBlock, tableBlockConfig, type RenderType } from '@milkdown/kit/component/table-block'
import { Slice, Fragment, type Node as ProseNode, type Schema } from '@milkdown/kit/prose/model'
import { Decoration } from '@milkdown/kit/prose/view'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import { upload, uploadConfig } from '@milkdown/kit/plugin/upload'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react'
import { AlignCenter, AlignLeft, AlignRight, ChevronDown, Copy, createElement, GripHorizontal, GripVertical, Plus, Search, Trash2, X, type IconNode } from 'lucide'
import { ImagePlus } from 'lucide-react'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ChangeEvent, type MouseEvent as ReactMouseEvent } from 'react'
import '@milkdown/kit/prose/view/style/prosemirror.css'
import '@milkdown/kit/prose/tables/style/tables.css'
import '@milkdown/crepe/theme/common/code-mirror.css'
import '@milkdown/crepe/theme/common/table.css'

const MAX_IMAGE_SIZE = 5 * 1024 * 1024

const tableControlIcons: Record<RenderType, IconNode> = {
  add_row: Plus,
  add_col: Plus,
  delete_row: Trash2,
  delete_col: Trash2,
  align_col_left: AlignLeft,
  align_col_center: AlignCenter,
  align_col_right: AlignRight,
  col_drag_handle: GripHorizontal,
  row_drag_handle: GripVertical,
}

function renderTableControl(type: RenderType) {
  return renderIcon(tableControlIcons[type])
}

function renderIcon(icon: IconNode) {
  return createElement(icon, {
    'aria-hidden': 'true',
    width: 16,
    height: 16,
    'stroke-width': 2,
  }).outerHTML
}

const codeLanguages = [
  LanguageDescription.of({
    name: 'JavaScript',
    alias: ['js'],
    load: () => import('@codemirror/lang-javascript').then(({ javascript }) => javascript()),
  }),
  LanguageDescription.of({
    name: 'TypeScript',
    alias: ['ts'],
    load: () => import('@codemirror/lang-javascript').then(({ javascript }) => javascript({ typescript: true })),
  }),
  LanguageDescription.of({
    name: 'CSS',
    alias: ['css'],
    load: () => import('@codemirror/lang-css').then(({ css }) => css()),
  }),
  LanguageDescription.of({
    name: 'HTML',
    alias: ['html'],
    load: () => import('@codemirror/lang-html').then(({ html }) => html()),
  }),
  LanguageDescription.of({
    name: 'Bash',
    alias: ['bash', 'sh', 'shell', 'zsh'],
    load: () => import('@codemirror/legacy-modes/mode/shell').then(
      ({ shell }) => new LanguageSupport(StreamLanguage.define(shell)),
    ),
  }),
]

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
  const menuItemRef = useRef<HTMLButtonElement>(null)
  const attachmentsRef = useRef(attachments)
  const onChangeRef = useRef(onChange)
  const onErrorRef = useRef(onError)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => { attachmentsRef.current = attachments }, [attachments])
  useEffect(() => { onChangeRef.current = onChange }, [onChange])
  useEffect(() => { onErrorRef.current = onError }, [onError])
  useEffect(() => {
    if (!contextMenu) return

    menuItemRef.current?.focus()
    const closeMenu = () => setContextMenu(null)
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu()
    }

    document.addEventListener('click', closeMenu)
    document.addEventListener('keydown', closeOnEscape)
    window.addEventListener('blur', closeMenu)
    window.addEventListener('resize', closeMenu)
    window.addEventListener('scroll', closeMenu, true)
    return () => {
      document.removeEventListener('click', closeMenu)
      document.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('blur', closeMenu)
      window.removeEventListener('resize', closeMenu)
      window.removeEventListener('scroll', closeMenu, true)
    }
  }, [contextMenu])

  const { get, loading } = useEditor((root) => Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root)
      ctx.set(defaultValueCtx, hydrateImages(value, attachmentsRef.current))
      ctx.update(tableBlockConfig.key, (config) => ({
        ...config,
        renderButton: renderTableControl,
      }))
      ctx.update(codeBlockConfig.key, (config) => ({
        ...config,
        extensions: [
          basicSetup,
          keymap.of(defaultKeymap.concat(indentWithTab)),
          oneDark,
        ],
        languages: codeLanguages,
        expandIcon: renderIcon(ChevronDown),
        searchIcon: renderIcon(Search),
        clearSearchIcon: renderIcon(X),
        copyIcon: renderIcon(Copy),
        copyText: 'Copy',
      }))
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
    .use(codeBlockComponent)
    .use(tableBlock)
    .use(clipboard)
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

  function openContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    const target = event.target
    const clickedImage = target instanceof Element && target.closest('img') !== null
    const selection = window.getSelection()
    const hasTextSelection = Boolean(
      selection
      && !selection.isCollapsed
      && selection.anchorNode
      && event.currentTarget.contains(selection.anchorNode),
    )

    if (clickedImage || hasTextSelection) {
      setContextMenu(null)
      return
    }

    event.preventDefault()
    setContextMenu({
      x: Math.min(event.clientX, window.innerWidth - 180),
      y: Math.min(event.clientY, window.innerHeight - 52),
    })
  }

  function openImagePicker(event: ReactMouseEvent<HTMLButtonElement>) {
    event.stopPropagation()
    setContextMenu(null)
    inputRef.current?.click()
  }

  return (
    <>
      <div className="mb-3 flex items-center">
        <span className="text-[9px] font-bold tracking-[0.1em] text-[var(--text-faint)] uppercase">Rich Markdown</span>
        <input ref={inputRef} className="sr-only" type="file" accept="image/*" multiple onChange={chooseImages} />
      </div>
      <div className="milkdown-editor min-h-[520px] rounded-md border border-[var(--background-modifier-border)] bg-[var(--background-primary)] px-5 py-4" aria-busy={loading} onContextMenu={openContextMenu}>
        <Milkdown />
      </div>
      {contextMenu && (
        <div
          className="fixed z-50 min-w-40 rounded-md border border-[var(--background-modifier-border)] bg-[var(--background-primary-alt)] p-1 shadow-lg"
          role="menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            ref={menuItemRef}
            className="flex w-full cursor-pointer items-center gap-2 rounded-sm border-0 bg-transparent px-2.5 py-2 text-left text-xs font-medium text-[var(--text-normal)] outline-none hover:bg-[var(--background-modifier-hover)] focus:bg-[var(--background-modifier-hover)]"
            type="button"
            role="menuitem"
            onClick={openImagePicker}
          >
            <ImagePlus size={15} />
            Add image
          </button>
        </div>
      )}
      <p className="mt-2.5 text-[9px] text-[var(--text-faint)]">Use Markdown shortcuts as you type, or paste and drop images directly into the note.</p>
    </>
  )
})

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, Props>(function MarkdownEditor(props, ref) {
  return <MilkdownProvider><EditorSurface ref={ref} {...props} /></MilkdownProvider>
})
