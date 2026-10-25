import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import {
  LanguageDescription,
  LanguageSupport,
  StreamLanguage,
} from "@codemirror/language";
import { oneDark } from "@codemirror/theme-one-dark";
import { keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import {
  commandsCtx,
  defaultValueCtx,
  Editor,
  editorViewCtx,
  rootCtx,
  serializerCtx,
} from "@milkdown/kit/core";
import {
  codeBlockComponent,
  codeBlockConfig,
} from "@milkdown/kit/component/code-block";
import {
  tableBlock,
  tableBlockConfig,
  type RenderType,
} from "@milkdown/kit/component/table-block";
import {
  Slice,
  Fragment,
  type Node as ProseNode,
  type Schema,
} from "@milkdown/kit/prose/model";
import { Decoration } from "@milkdown/kit/prose/view";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { clipboard } from "@milkdown/kit/plugin/clipboard";
import {
  history,
  redoCommand,
  undoCommand,
} from "@milkdown/kit/plugin/history";
import { upload, uploadConfig } from "@milkdown/kit/plugin/upload";
import { redoDepth, undoDepth } from "@milkdown/kit/prose/history";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ChevronDown,
  Copy,
  createElement,
  GripHorizontal,
  GripVertical,
  Plus,
  Search,
  Trash2,
  X,
  type IconNode,
} from "lucide";
import { ImageDown, ImagePlus, LoaderCircle, X as XIcon } from "lucide-react";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import "@milkdown/kit/prose/view/style/prosemirror.css";
import "@milkdown/kit/prose/tables/style/tables.css";
import "@milkdown/crepe/theme/common/code-mirror.css";
import "@milkdown/crepe/theme/common/table.css";

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

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
};

function renderTableControl(type: RenderType) {
  return renderIcon(tableControlIcons[type]);
}

function renderIcon(icon: IconNode) {
  return createElement(icon, {
    "aria-hidden": "true",
    width: 16,
    height: 16,
    "stroke-width": 2,
  }).outerHTML;
}

const codeLanguages = [
  LanguageDescription.of({
    name: "JavaScript",
    alias: ["js"],
    load: () =>
      import("@codemirror/lang-javascript").then(({ javascript }) =>
        javascript(),
      ),
  }),
  LanguageDescription.of({
    name: "TypeScript",
    alias: ["ts"],
    load: () =>
      import("@codemirror/lang-javascript").then(({ javascript }) =>
        javascript({ typescript: true }),
      ),
  }),
  LanguageDescription.of({
    name: "CSS",
    alias: ["css"],
    load: () => import("@codemirror/lang-css").then(({ css }) => css()),
  }),
  LanguageDescription.of({
    name: "HTML",
    alias: ["html"],
    load: () => import("@codemirror/lang-html").then(({ html }) => html()),
  }),
  LanguageDescription.of({
    name: "Bash",
    alias: ["bash", "sh", "shell", "zsh"],
    load: () =>
      import("@codemirror/legacy-modes/mode/shell").then(
        ({ shell }) => new LanguageSupport(StreamLanguage.define(shell)),
      ),
  }),
];

type Props = {
  value: string;
  attachments: Record<string, string>;
  onChange: (value: string, attachments: Record<string, string>) => void;
  onError: (message: string) => void;
};

export type MarkdownEditorHandle = {
  getValue: () => { value: string; attachments: Record<string, string> };
};

function hydrateImages(markdown: string, attachments: Record<string, string>) {
  return markdown.replace(
    /(!\[[^\]]*\]\()attachment:([^)\s]+)(\))/g,
    (match, opening: string, id: string, closing: string) => {
      const source = attachments[id];
      return source ? `${opening}${source}${closing}` : match;
    },
  );
}

function extractImages(markdown: string, stored: Record<string, string>) {
  const attachments = { ...stored };
  const knownImages = new Map(
    Object.entries(attachments).map(([id, source]) => [source, id]),
  );
  const value = markdown.replace(
    /!\[([^\]]*)\]\((data:image\/(?:avif|gif|jpeg|png|webp);base64,[A-Za-z0-9+/=]+)\)/gi,
    (_match, alt: string, source: string) => {
      let id = knownImages.get(source);
      if (!id) {
        id = `image-${crypto.randomUUID()}`;
        attachments[id] = source;
        knownImages.set(source, id);
      }
      return `![${alt}](attachment:${id})`;
    },
  );
  return { value, attachments };
}

function readImage(file: File) {
  return new Promise<{ alt: string; src: string }>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve({
        alt: file.name.replace(/[\[\]\n\r]/g, " "),
        src: String(reader.result),
      });
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

function dataUrlSize(source: string) {
  const payload = source.slice(source.indexOf(",") + 1);
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.floor((payload.length * 3) / 4) - padding;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function imageFormat(source: string) {
  const format = source.match(/^data:image\/([^;,]+)/i)?.[1];
  return format ? format.replace("jpeg", "JPEG").toUpperCase() : "Image";
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(new Error("Could not encode the compressed image."));
    reader.readAsDataURL(blob);
  });
}

async function compressImage(source: string, quality: number) {
  if (!source.startsWith("data:image/"))
    throw new Error("Only attached images can be compressed.");
  if (source.startsWith("data:image/gif"))
    throw new Error(
      "Animated GIFs cannot be compressed without losing animation.",
    );

  const image = new Image();
  image.src = source;
  await image.decode();

  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context)
    throw new Error("Image compression is not supported by this browser.");
  context.drawImage(image, 0, 0);

  const outputType = source.startsWith("data:image/jpeg")
    ? "image/jpeg"
    : "image/webp";
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) =>
        result
          ? resolve(result)
          : reject(new Error("Could not compress this image.")),
      outputType,
      quality,
    );
  });
  return { source: await blobToDataUrl(blob), size: blob.size };
}

async function imageNodes(
  files: File[],
  schema: Schema,
  onError: Props["onError"],
) {
  const images = files.filter((file) => file.type.startsWith("image/"));
  const oversized = images.find((file) => file.size > MAX_IMAGE_SIZE);
  if (oversized) {
    const message = `${oversized.name} is larger than 5 MB.`;
    onError(message);
    throw new Error(message);
  }
  if (!images.length) return [];
  onError("");
  const encoded = await Promise.all(images.map(readImage));
  return encoded.map(({ alt, src }) => schema.nodes.image.create({ src, alt }));
}

const EditorSurface = forwardRef<MarkdownEditorHandle, Props>(
  function EditorSurface({ value, attachments, onChange, onError }, ref) {
    const inputRef = useRef<HTMLInputElement>(null);
    const menuItemRef = useRef<HTMLButtonElement>(null);
    const attachmentsRef = useRef(attachments);
    const onChangeRef = useRef(onChange);
    const onErrorRef = useRef(onError);
    const [contextMenu, setContextMenu] = useState<{
      x: number;
      y: number;
    } | null>(null);
    const [historyState, setHistoryState] = useState({
      canUndo: false,
      canRedo: false,
    });
    const [imageAction, setImageAction] = useState<{
      element: HTMLImageElement;
      x: number;
      y: number;
    } | null>(null);
    const [compressionDialog, setCompressionDialog] = useState<{
      element: HTMLImageElement;
      source: string;
      size: number;
    } | null>(null);
    const [compressionQuality, setCompressionQuality] = useState(80);
    const [compressionResult, setCompressionResult] = useState<{
      source: string;
      size: number;
    } | null>(null);
    const [compressionError, setCompressionError] = useState("");
    const [estimatingCompression, setEstimatingCompression] = useState(false);

    useEffect(() => {
      attachmentsRef.current = attachments;
    }, [attachments]);
    useEffect(() => {
      onChangeRef.current = onChange;
    }, [onChange]);
    useEffect(() => {
      onErrorRef.current = onError;
    }, [onError]);
    useEffect(() => {
      if (!compressionDialog) return;
      let active = true;
      setEstimatingCompression(true);
      setCompressionResult(null);
      setCompressionError("");
      const timeout = window.setTimeout(() => {
        void compressImage(compressionDialog.source, compressionQuality / 100)
          .then((result) => {
            if (active) setCompressionResult(result);
          })
          .catch((caught) => {
            if (active)
              setCompressionError(
                caught instanceof Error
                  ? caught.message
                  : "Could not compress this image.",
              );
          })
          .finally(() => {
            if (active) setEstimatingCompression(false);
          });
      }, 180);
      return () => {
        active = false;
        window.clearTimeout(timeout);
      };
    }, [compressionDialog, compressionQuality]);
    useEffect(() => {
      if (!compressionDialog) return;
      const closeOnEscape = (event: KeyboardEvent) => {
        if (event.key === "Escape") setCompressionDialog(null);
      };
      document.addEventListener("keydown", closeOnEscape);
      return () => document.removeEventListener("keydown", closeOnEscape);
    }, [compressionDialog]);
    useEffect(() => {
      if (!contextMenu) return;

      menuItemRef.current?.focus();
      const closeMenu = () => setContextMenu(null);
      const closeOnEscape = (event: KeyboardEvent) => {
        if (event.key === "Escape") closeMenu();
      };

      document.addEventListener("click", closeMenu);
      document.addEventListener("keydown", closeOnEscape);
      window.addEventListener("blur", closeMenu);
      window.addEventListener("resize", closeMenu);
      window.addEventListener("scroll", closeMenu, true);
      return () => {
        document.removeEventListener("click", closeMenu);
        document.removeEventListener("keydown", closeOnEscape);
        window.removeEventListener("blur", closeMenu);
        window.removeEventListener("resize", closeMenu);
        window.removeEventListener("scroll", closeMenu, true);
      };
    }, [contextMenu]);

    const { get, loading } = useEditor((root) =>
      Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, root);
          ctx.set(
            defaultValueCtx,
            hydrateImages(value, attachmentsRef.current),
          );
          ctx.update(tableBlockConfig.key, (config) => ({
            ...config,
            renderButton: renderTableControl,
          }));
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
            copyText: "Copy",
          }));
          ctx.set(uploadConfig.key, {
            enableHtmlFileUploader: true,
            uploader: async (files, schema) =>
              imageNodes([...files], schema, onErrorRef.current),
            uploadWidgetFactory: (pos, spec) => {
              const element = document.createElement("span");
              element.className = "milkdown-image-loading";
              element.textContent = "Adding image…";
              return Decoration.widget(pos, element, spec);
            },
          });
          ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
            const extracted = extractImages(markdown, attachmentsRef.current);
            attachmentsRef.current = extracted.attachments;
            onChangeRef.current(extracted.value, extracted.attachments);
          });
          ctx.get(listenerCtx).updated((_ctx) => {
            const state = _ctx.get(editorViewCtx).state;
            setHistoryState({
              canUndo: undoDepth(state) > 0,
              canRedo: redoDepth(state) > 0,
            });
          });
        })
        .use(commonmark)
        .use(gfm)
        .use(codeBlockComponent)
        .use(tableBlock)
        .use(clipboard)
        .use(history)
        .use(listener)
        .use(upload),
    );

    useImperativeHandle(
      ref,
      () => ({
        getValue: () => {
          const editor = get();
          if (!editor) return { value, attachments: attachmentsRef.current };
          return editor.action((ctx) => {
            const markdown = ctx.get(serializerCtx)(
              ctx.get(editorViewCtx).state.doc,
            );
            return extractImages(markdown, attachmentsRef.current);
          });
        },
      }),
      [get, value],
    );

    async function chooseImages(event: ChangeEvent<HTMLInputElement>) {
      const files = [...(event.target.files ?? [])];
      event.target.value = "";
      const editor = get();
      if (!editor || !files.length) return;
      try {
        const nodes = await editor.action((ctx) =>
          imageNodes(
            files,
            ctx.get(editorViewCtx).state.schema,
            onErrorRef.current,
          ),
        );
        if (!nodes.length) return;
        editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          const content = Fragment.fromArray(nodes as ProseNode[]);
          view.dispatch(
            view.state.tr
              .replaceSelection(new Slice(content, 0, 0))
              .scrollIntoView(),
          );
          view.focus();
        });
      } catch (caught) {
        onErrorRef.current(
          caught instanceof Error ? caught.message : "Could not add the image.",
        );
      }
    }

    function openContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
      const target = event.target;
      const clickedImage =
        target instanceof Element && target.closest("img") !== null;
      const selection = window.getSelection();
      const hasTextSelection = Boolean(
        selection &&
        !selection.isCollapsed &&
        selection.anchorNode &&
        event.currentTarget.contains(selection.anchorNode),
      );

      if (clickedImage || hasTextSelection) {
        setContextMenu(null);
        return;
      }

      event.preventDefault();
      setContextMenu({
        x: Math.min(event.clientX, window.innerWidth - 180),
        y: Math.min(event.clientY, window.innerHeight - 52),
      });
    }

    function openImagePicker(event: ReactMouseEvent<HTMLButtonElement>) {
      event.stopPropagation();
      setContextMenu(null);
      inputRef.current?.click();
    }

    function runHistoryCommand(
      command: typeof undoCommand | typeof redoCommand,
    ) {
      const editor = get();
      if (!editor) return;
      editor.action((ctx) => {
        ctx.get(commandsCtx).call(command.key);
        const view = ctx.get(editorViewCtx);
        setHistoryState({
          canUndo: undoDepth(view.state) > 0,
          canRedo: redoDepth(view.state) > 0,
        });
        view.focus();
      });
    }

    function updateImageAction(event: ReactMouseEvent<HTMLDivElement>) {
      const target = event.target;
      if (!(target instanceof Element) || target.closest("[data-image-action]"))
        return;
      const image = target.closest("img");
      if (!(image instanceof HTMLImageElement)) {
        if (imageAction) setImageAction(null);
        return;
      }
      const rect = image.getBoundingClientRect();
      const x = Math.max(8, Math.min(rect.right - 36, window.innerWidth - 44));
      const y = Math.max(8, rect.top + 8);
      if (
        imageAction?.element !== image ||
        imageAction.x !== x ||
        imageAction.y !== y
      )
        setImageAction({ element: image, x, y });
    }

    function openCompressionDialog() {
      const selected = imageAction;
      if (!selected) return;
      if (!selected.element.src.startsWith("data:image/")) {
        onErrorRef.current("Only attached images can be compressed.");
        setImageAction(null);
        return;
      }
      setCompressionQuality(80);
      setCompressionResult(null);
      setCompressionError("");
      setCompressionDialog({
        element: selected.element,
        source: selected.element.src,
        size: dataUrlSize(selected.element.src),
      });
      setImageAction(null);
    }

    function applyCompression() {
      const dialog = compressionDialog;
      const result = compressionResult;
      const editor = get();
      if (!dialog || !result || result.size >= dialog.size || !editor) return;

      onErrorRef.current("");
      try {
        editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          let position = view.posAtDOM(dialog.element, 0);
          let node = view.state.doc.nodeAt(position);
          if (node?.type.name !== "image" && position > 0) {
            position -= 1;
            node = view.state.doc.nodeAt(position);
          }
          if (node?.type.name !== "image")
            throw new Error("The image is no longer in the note.");
          view.dispatch(
            view.state.tr
              .setNodeMarkup(position, undefined, {
                ...node.attrs,
                src: result.source,
              })
              .scrollIntoView(),
          );
          view.focus();
        });
        setCompressionDialog(null);
      } catch (caught) {
        setCompressionError(
          caught instanceof Error
            ? caught.message
            : "Could not compress this image.",
        );
      }
    }

    return (
      <>
        <input
          ref={inputRef}
          className="sr-only"
          type="file"
          accept="image/*"
          multiple
          onChange={chooseImages}
        />
        <div
          className="milkdown-editor min-h-[520px] rounded-md py-4"
          aria-busy={loading}
          onContextMenu={openContextMenu}
          onMouseMove={updateImageAction}
          onMouseLeave={() => setImageAction(null)}
        >
          <Milkdown />
          {imageAction && (
            <button
              className="fixed z-40 inline-flex size-8 cursor-pointer items-center justify-center rounded-md border border-white/15 bg-black/75 text-white shadow-lg backdrop-blur-sm hover:bg-[var(--interactive-accent)] disabled:cursor-wait disabled:opacity-70"
              data-image-action
              type="button"
              aria-label="Compress image"
              title="Compress image"
              style={{ left: imageAction.x, top: imageAction.y }}
              onMouseDown={(event) => event.preventDefault()}
              onClick={openCompressionDialog}
            >
              <ImageDown size={16} />
            </button>
          )}
        </div>
        {compressionDialog && (
          <div
            className="fixed inset-0 z-[70] flex items-center justify-center p-4 backdrop-blur-[2px]"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget)
                setCompressionDialog(null);
            }}
          >
            <div
              className="w-full max-w-md rounded-lg border border-[var(--background-modifier-border)] p-5 shadow-2xl"
              role="dialog"
              aria-modal="true"
              aria-labelledby="compress-image-title"
            >
              <div className="mb-5 flex items-start justify-between gap-4">
                <div>
                  <h2
                    id="compress-image-title"
                    className="text-base font-semibold text-[var(--text-normal)]"
                  >
                    Compress image
                  </h2>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    Choose the visual quality. Pixel dimensions will not change.
                  </p>
                </div>
                <button
                  className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)]"
                  type="button"
                  aria-label="Close"
                  onClick={() => setCompressionDialog(null)}
                >
                  <XIcon size={17} />
                </button>
              </div>

              <div className="mb-5 grid grid-cols-3 gap-2 rounded-md p-3 text-xs">
                <div>
                  <div className="text-[var(--text-faint)]">Current size</div>
                  <div className="mt-1 font-medium text-[var(--text-normal)]">
                    {formatBytes(compressionDialog.size)}
                  </div>
                </div>
                <div>
                  <div className="text-[var(--text-faint)]">Format</div>
                  <div className="mt-1 font-medium text-[var(--text-normal)]">
                    {imageFormat(compressionDialog.source)}
                  </div>
                </div>
                <div>
                  <div className="text-[var(--text-faint)]">Dimensions</div>
                  <div className="mt-1 font-medium text-[var(--text-normal)]">
                    {compressionDialog.element.naturalWidth} ×{" "}
                    {compressionDialog.element.naturalHeight}
                  </div>
                </div>
              </div>

              <label
                className="mb-2 flex items-center justify-between text-xs font-medium text-[var(--text-normal)]"
                htmlFor="image-compression-quality"
              >
                <span>Quality</span>
                <span className="text-[var(--text-accent)]">
                  {compressionQuality}%
                </span>
              </label>
              <input
                id="image-compression-quality"
                className="w-full cursor-pointer accent-[var(--interactive-accent)]"
                type="range"
                min="10"
                max="95"
                step="1"
                value={compressionQuality}
                onChange={(event) => {
                  setCompressionResult(null);
                  setEstimatingCompression(true);
                  setCompressionQuality(Number(event.target.value));
                }}
              />
              <div className="mt-1 flex justify-between text-[10px] text-[var(--text-faint)]">
                <span>Smaller file</span>
                <span>Higher quality</span>
              </div>

              <div className="mt-5 min-h-14 rounded-md border border-[var(--background-modifier-border)] px-3 py-2.5 text-xs">
                {estimatingCompression ? (
                  <div className="flex items-center gap-2 text-[var(--text-muted)]">
                    <LoaderCircle className="animate-spin" size={14} />{" "}
                    Estimating file size…
                  </div>
                ) : compressionError ? (
                  <div className="text-[var(--text-error)]">
                    {compressionError}
                  </div>
                ) : compressionResult ? (
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[var(--text-faint)]">
                        Estimated result
                      </div>
                      <div className="mt-0.5 font-medium text-[var(--text-normal)]">
                        {formatBytes(compressionResult.size)} ·{" "}
                        {imageFormat(compressionResult.source)}
                      </div>
                    </div>
                    <div
                      className={
                        compressionResult.size < compressionDialog.size
                          ? "font-semibold text-emerald-400"
                          : "text-amber-400"
                      }
                    >
                      {compressionResult.size < compressionDialog.size
                        ? `${Math.round((1 - compressionResult.size / compressionDialog.size) * 100)}% smaller`
                        : "No size reduction"}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="mt-5 flex justify-end gap-2">
                <button
                  className="cursor-pointer rounded-md border border-[var(--background-modifier-border)] bg-transparent px-4 py-2 text-xs font-semibold text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)]"
                  type="button"
                  onClick={() => setCompressionDialog(null)}
                >
                  Cancel
                </button>
                <button
                  className="inline-flex min-w-24 cursor-pointer items-center justify-center rounded-md border-0 bg-[var(--interactive-accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--interactive-accent-hover)] disabled:cursor-not-allowed disabled:opacity-45"
                  type="button"
                  disabled={
                    estimatingCompression ||
                    !compressionResult ||
                    compressionResult.size >= compressionDialog.size
                  }
                  onClick={applyCompression}
                >
                  Compress
                </button>
              </div>
            </div>
          </div>
        )}
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
      </>
    );
  },
);

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, Props>(
  function MarkdownEditor(props, ref) {
    return (
      <MilkdownProvider>
        <EditorSurface ref={ref} {...props} />
      </MilkdownProvider>
    );
  },
);
