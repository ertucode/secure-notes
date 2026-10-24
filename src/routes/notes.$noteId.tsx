import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { Tag } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useVault } from "~/context/VaultContext";
import type { Note } from "~/lib/notes.schemas";
import { MessagePage, backLinkClasses } from "~/components/ui";
import {
  MarkdownEditor,
  type MarkdownEditorHandle,
} from "~/components/MarkdownEditor";

export const Route = createFileRoute("/notes/$noteId")({
  head: () => ({ meta: [{ title: "Encrypted note — Ciphernote" }] }),
  component: NoteEditor,
});

function extractEmbeddedImages(
  content: string,
  stored: Record<string, string>,
) {
  const attachments = { ...stored };
  const knownImages = new Map(
    Object.entries(attachments).map(([id, source]) => [source, id]),
  );
  const nextContent = content.replace(
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
  return { content: nextContent, attachments };
}

function NoteEditor() {
  const { noteId } = Route.useParams();
  const vault = useVault();
  const note = vault.notes.find((item) => item.id === noteId);

  if (!note)
    return (
      <MessagePage
        title="Note not found"
        action={
          <Link to="/" className={backLinkClasses}>
            Back to notes
          </Link>
        }
      >
        This file may have been renamed or deleted on GitHub.
      </MessagePage>
    );

  // A route change must create fresh form and Milkdown state. Without this
  // boundary, the new editor can initialize from the previous note's state
  // before an effect has a chance to synchronize it.
  return <NoteEditorForm key={note.id} note={note} />;
}

function NoteEditorForm({ note }: { note: Note }) {
  const vault = useVault();
  const router = useRouter();
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const initial = extractEmbeddedImages(note.content, note.attachments ?? {});
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(initial.content);
  const [attachments, setAttachments] = useState<Record<string, string>>(
    initial.attachments,
  );
  const [tags, setTags] = useState(note.tags.join(", "));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const focusKey = "ciphernote.focusNewNoteTitle";
    if (sessionStorage.getItem(focusKey) !== note.id) return;
    sessionStorage.removeItem(focusKey);
    titleRef.current?.focus();
    titleRef.current?.select();
  }, [note.id]);

  const persist = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      const currentEditor = editorRef.current?.getValue();
      const updated = await vault.saveNote({
        id: note.id,
        title: title || "Untitled note",
        content: currentEditor?.value ?? content,
        attachments: currentEditor?.attachments ?? attachments,
        folder: note.folder,
        tags: tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      });
      if (updated.id !== note.id) {
        await router.navigate({
          to: "/notes/$noteId",
          params: { noteId: updated.id },
          replace: true,
        });
      }
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not save this note.",
      );
    } finally {
      setSaving(false);
    }
  }, [attachments, content, note, router, saving, tags, title, vault]);

  useEffect(() => {
    function saveShortcut(event: KeyboardEvent) {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLocaleLowerCase() === "s"
      ) {
        event.preventDefault();
        void persist();
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLocaleLowerCase() === "d"
      ) {
        event.preventDefault();
        void remove();
      }
    }
    window.addEventListener("keydown", saveShortcut);
    return () => window.removeEventListener("keydown", saveShortcut);
  }, [persist]);

  async function remove() {
    if (!window.confirm("Delete this encrypted file from GitHub permanently?"))
      return;
    try {
      await vault.deleteNote(note.id);
      await router.navigate({ to: "/" });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not delete this note.",
      );
    }
  }

  // TODO: use saved, disabled: saving

  return (
    <div className="min-h-screen bg-[var(--background-primary-alt)]">
      <div className="mx-auto min-h-[calc(100vh-120px)] w-[calc(100%-20px)] rounded-t-sm bg-[var(--background-primary-alt)] px-6 pt-7 pb-6 min-[721px]:w-[min(1180px,calc(100%-80px))] min-[721px]:px-[42px] min-[721px]:pt-8">
        {error && (
          <p
            className="mt-[18px] mb-[-10px] rounded-md bg-[#3d2526] px-[11px] py-[9px] text-[11px] text-[var(--text-error)]"
            role="alert"
          >
            {error}
          </p>
        )}
        <input
          ref={titleRef}
          className="mt-[30px] w-full border-0 bg-transparent p-0 font-serif text-[34px] font-semibold tracking-[-1px] text-[var(--text-normal)] outline-0 placeholder:text-[var(--text-faint)] min-[721px]:text-[42px]"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Untitled note"
          maxLength={120}
        />
        <label className="mt-[18px] flex items-center gap-2 text-[var(--text-faint)]">
          <Tag size={16} />
          <input
            className="w-full border-0 bg-transparent p-0 text-[10px] text-[var(--text-muted)] outline-0 placeholder:text-[var(--text-faint)]"
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder="Add tags, separated by commas"
          />
        </label>
        <div className="my-[25px] h-px bg-[var(--background-modifier-border)]" />
        <MarkdownEditor
          key={note.id}
          ref={editorRef}
          value={content}
          attachments={attachments}
          onChange={(value, nextAttachments) => {
            setContent(value);
            setAttachments(nextAttachments);
          }}
          onError={setError}
        />
        <footer className="flex gap-[15px] border-t border-[var(--background-modifier-border)] pt-[15px] text-[9px] text-[var(--text-faint)]">
          <span>
            {content.trim() ? content.trim().split(/\s+/).length : 0} words
          </span>
          <span>{content.length} characters</span>
          <span>Markdown · AES-256-GCM</span>
        </footer>
      </div>
    </div>
  );
}
