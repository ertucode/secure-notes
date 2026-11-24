import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { Check, LoaderCircle, Save, Tag, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useVault } from "~/context/VaultContext";
import type { Note } from "~/lib/notes.schemas";
import { useNoteScroll } from "~/lib/use-note-scroll";
import { copyNoteSelection, noteSelectionKey } from "~/lib/note-selection";
import { readNoteDraft, writeNoteDraft, removeNoteDraft, sameNoteDraft, type NoteDraft } from "~/lib/note-drafts";
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

function sameAttachments(
  current: Record<string, string>,
  next: Record<string, string>,
) {
  const entries = Object.entries(current);
  return (
    entries.length === Object.keys(next).length &&
    entries.every(([id, source]) => next[id] === source)
  );
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

  if (vault.loading)
    return (
      <MessagePage title="Loading encrypted notes">
        {vault.loadProgress.completed} of {vault.loadProgress.total} notes
        loaded. Editing will be available when loading finishes.
      </MessagePage>
    );

  if (note.loadError)
    return (
      <MessagePage
        title="Could not decrypt note"
        action={
          <Link to="/" className={backLinkClasses}>
            Back to notes
          </Link>
        }
      >
        {note.loadError}
      </MessagePage>
    );

  if (note.loaded === false)
    return <MessagePage title="Loading note">Please wait…</MessagePage>;

  // A route change must create fresh form and Milkdown state. Without this
  // boundary, the new editor can initialize from the previous note's state
  // before an effect has a chance to synchronize it.
  return <NoteAttachmentGate key={note.id} note={note} />;
}

function NoteAttachmentGate({ note }: { note: Note }) {
  const vault = useVault();
  const attachmentsAreLoaded = Object.keys(note.attachmentFiles ?? {}).every(
    (id) => note.attachments?.[id],
  );
  const [loadedNote, setLoadedNote] = useState<Note | null>(() =>
    attachmentsAreLoaded ? note : null,
  );
  const [error, setError] = useState("");

  useEffect(() => {
    const ready = Object.keys(note.attachmentFiles ?? {}).every(
      (id) => note.attachments?.[id],
    );
    if (ready) {
      setLoadedNote(note);
      setError("");
      return;
    }

    let active = true;
    setLoadedNote(null);
    setError("");
    void vault.loadNoteAttachments(note.id).then(
      (attachments) => {
        if (active) setLoadedNote({ ...note, attachments });
      },
      (caught) => {
        if (active)
          setError(
            caught instanceof Error
              ? caught.message
              : "Could not load this note’s attachments.",
          );
      },
    );
    return () => {
      active = false;
    };
  }, [note.id]);

  if (error)
    return (
      <MessagePage title="Could not load attachments">{error}</MessagePage>
    );
  if (!loadedNote)
    return <MessagePage title="Loading attachments">Please wait…</MessagePage>;
  return <NoteDraftGate note={loadedNote} />;
}

function NoteDraftGate({ note }: { note: Note }) {
  const { repository } = useVault();
  const [restored, setRestored] = useState<{ draft: NoteDraft | null; error: string } | null>(null);
  useEffect(() => {
    let active = true;
    void readNoteDraft(repository, note.id).then(
      (draft) => { if (active) setRestored({ draft, error: "" }); },
      () => { if (active) setRestored({ draft: null, error: "Local draft recovery is unavailable. Save your changes before refreshing." }); },
    );
    return () => { active = false; };
  }, [repository, note.id]);
  if (!restored) return <MessagePage title="Restoring draft">Please wait…</MessagePage>;
  return <NoteEditorForm note={note} draft={restored.draft} recoveryError={restored.error} />;
}

function NoteEditorForm({ note, draft, recoveryError }: { note: Note; draft: NoteDraft | null; recoveryError: string }) {
  const vault = useVault();
  const router = useRouter();
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  useNoteScroll(vault.repository, note.id, scrollContainerRef);
  const [baseline, setBaseline] = useState<NoteDraft>(() => ({
    title: note.title,
    ...extractEmbeddedImages(note.content, note.attachments ?? {}),
    tags: note.tags.join(", "),
  }));
  const [initial] = useState(() => draft
    ? extractEmbeddedImages(draft.content, draft.attachments)
    : baseline);
  const [title, setTitle] = useState(draft?.title ?? note.title);
  const [content, setContent] = useState(initial.content);
  const [attachments, setAttachments] = useState<Record<string, string>>(
    initial.attachments,
  );
  const [tags, setTags] = useState(draft?.tags ?? note.tags.join(", "));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saved, setSaved] = useState(false);
  const dirty = !sameNoteDraft({ title, content, attachments, tags }, baseline);
  const [error, setError] = useState("");
  const [draftError, setDraftError] = useState(recoveryError);
  const pendingDraftWrites = useRef(0);
  const draftFailed = useRef(Boolean(recoveryError));
  const latestDraft = useRef<NoteDraft>({ title, content, attachments, tags });
  latestDraft.current = { title, content, attachments, tags };
  const changeVersionRef = useRef(0);
  const { setNoteUnsaved } = vault;

  useEffect(() => {
    if (!dirty) {
      void removeNoteDraft(vault.repository, note.id).catch(() => {});
      return;
    }
    let active = true;
    pendingDraftWrites.current += 1;
    void writeNoteDraft(vault.repository, note.id, { title, content, attachments, tags }).then(
      () => {
        draftFailed.current = false;
        if (active) setDraftError("");
      },
      () => {
        draftFailed.current = true;
        if (active) setDraftError("Your latest changes could not be backed up locally. Save before refreshing to avoid losing them.");
      },
    ).finally(() => { pendingDraftWrites.current -= 1; });
    return () => { active = false; };
  }, [dirty, title, content, attachments, tags, note.id, vault.repository]);

  useEffect(() => {
    const warnIfUnprotected = (event: BeforeUnloadEvent) => {
      if (dirty && (pendingDraftWrites.current > 0 || draftFailed.current)) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warnIfUnprotected);
    return () => window.removeEventListener("beforeunload", warnIfUnprotected);
  }, [dirty]);

  useEffect(() => {
    setNoteUnsaved(note.id, dirty);
  }, [dirty, note.id, setNoteUnsaved]);

  const markChanged = () => {
    changeVersionRef.current += 1;
    setSaved(false);
  };

  useEffect(() => {
    const focusKey = "ciphernote.focusNewNoteTitle";
    if (sessionStorage.getItem(focusKey) !== note.id) return;
    sessionStorage.removeItem(focusKey);
    titleRef.current?.focus();
    titleRef.current?.select();
  }, [note.id]);

  const persist = useCallback(async () => {
    if (saving) return;
    const savingVersion = changeVersionRef.current;
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      if (!editorRef.current) throw new Error("The editor is not ready. Please wait before saving.");
      const currentEditor = editorRef.current.getValue();
      const savingDraft = {
        title: title || "Untitled note",
        content: currentEditor.value,
        attachments: currentEditor.attachments,
        tags,
      };
      // Back up the live editor snapshot before starting the network save.
      // Never overwrite the note with stale React state if the editor is absent.
      setContent(savingDraft.content);
      setAttachments(savingDraft.attachments);
      await writeNoteDraft(vault.repository, note.id, savingDraft).catch(() => {
        setDraftError("Local backup failed. Keep this tab open until saving finishes.");
      });
      const updated = await vault.saveNote({
        id: note.id,
        title: savingDraft.title,
        content: savingDraft.content,
        attachments: savingDraft.attachments,
        folder: note.folder,
        tags: tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      });
      setBaseline(savingDraft);
      const changedWhileSaving = changeVersionRef.current !== savingVersion;
      if (updated.id === note.id) setNoteUnsaved(note.id, changedWhileSaving);
      if (updated.id !== note.id) {
        copyNoteSelection(vault.repository, note.id, updated.id);
        if (changedWhileSaving) {
          await writeNoteDraft(vault.repository, updated.id, latestDraft.current);
        }
        await removeNoteDraft(vault.repository, note.id).catch(() => {
          setDraftError("The saved note’s local draft could not be cleared.");
        });
        setNoteUnsaved(note.id, false);
        setNoteUnsaved(updated.id, changedWhileSaving);
        await router.navigate({
          to: "/notes/$noteId",
          params: { noteId: updated.id },
          replace: true,
        });
      }
      if (changeVersionRef.current === savingVersion) {
        if (updated.id === note.id) {
          await removeNoteDraft(vault.repository, note.id).catch(() => {
            setDraftError("The saved note’s local draft could not be cleared.");
          });
        }
        // An edit can arrive while the draft removal transaction is running.
        if (changeVersionRef.current !== savingVersion) {
          await writeNoteDraft(vault.repository, updated.id, latestDraft.current);
          return;
        }
        setSaved(true);
        window.setTimeout(() => setSaved(false), 1800);
      }
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
    setDeleting(true);
    setError("");
    try {
      await vault.deleteNote(note.id);
      await removeNoteDraft(vault.repository, note.id).catch(() => {});
      setNoteUnsaved(note.id, false);
      await router.navigate({ to: "/" });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not delete this note.",
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div ref={scrollContainerRef} className="min-h-screen bg-[var(--background-primary-alt)]">
      <div className="mx-auto min-h-[calc(100vh-120px)] w-[calc(100%-20px)] rounded-t-sm bg-[var(--background-primary-alt)] px-6 pt-7 pb-28 min-[721px]:w-[min(1180px,calc(100%-80px))] min-[721px]:px-[42px] min-[721px]:pt-8 min-[721px]:pb-6">
        {(error || draftError) && (
          <p
            className="mt-[18px] mb-[-10px] rounded-md bg-[#3d2526] px-[11px] py-[9px] text-[11px] text-[var(--text-error)]"
            role="alert"
          >
            {error || draftError}
          </p>
        )}
        <div className="flex items-center gap-3">
          <input
            ref={titleRef}
            className="min-w-0 flex-1 border-0 bg-transparent p-0 font-serif text-[34px] font-semibold tracking-[-1px] text-[var(--text-normal)] outline-0 placeholder:text-[var(--text-faint)] min-[721px]:text-[42px]"
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              markChanged();
            }}
            placeholder="Untitled note"
            maxLength={120}
          />
          {saving ? (
            <LoaderCircle
              className="shrink-0 animate-spin text-amber-400"
              size={18}
              aria-label="Saving note"
            />
          ) : dirty ? (
            <span
              className="size-3 shrink-0 rounded-full bg-amber-400 shadow-[0_0_0_3px_rgba(251,191,36,0.12)]"
              title="Unsaved changes"
              aria-label="Unsaved changes"
              role="status"
            />
          ) : null}
        </div>
        <MarkdownEditor
          key={note.id}
          selectionKey={noteSelectionKey(vault.repository, note.id)}
          ref={editorRef}
          value={content}
          attachments={attachments}
          onChange={(value, nextAttachments, normalize) => {
            // Compare the saved Markdown in the editor's canonical format, so
            // harmless serialization changes do not leave a false dirty dot.
            setBaseline((previous) => {
              const normalized = normalize(previous.content);
              return normalized === previous.content ? previous : { ...previous, content: normalized };
            });
            if (
              content !== value ||
              !sameAttachments(attachments, nextAttachments)
            )
              markChanged();
            setContent(value);
            setAttachments(nextAttachments);
          }}
          onError={setError}
        />
      </div>
      <div className="fixed inset-x-0 bottom-0 z-30 flex gap-3 border-t border-[var(--background-modifier-border)] bg-vault-100/95 px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(0,0,0,0.25)] backdrop-blur-xl min-[721px]:hidden">
        <button
          className="inline-flex min-h-12 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border border-[var(--background-modifier-border)] bg-[var(--background-primary-alt)] text-sm font-semibold text-[var(--text-muted)] active:border-[var(--text-error)] active:bg-[#3d2526] active:text-[var(--text-error)] disabled:cursor-wait disabled:opacity-55"
          type="button"
          disabled={saving || deleting}
          onClick={() => void remove()}
        >
          <Trash2 size={18} />
          {deleting ? "Deleting…" : "Delete"}
        </button>
        <button
          className="inline-flex min-h-12 flex-[1.4] cursor-pointer items-center justify-center gap-2 rounded-lg border-0 bg-vault-500 text-sm font-semibold text-[var(--text-on-accent)] active:bg-vault-700 disabled:cursor-wait disabled:opacity-65"
          type="button"
          disabled={saving || deleting}
          onClick={() => void persist()}
        >
          {saving ? (
            <LoaderCircle className="animate-spin" size={18} />
          ) : saved ? (
            <Check size={18} />
          ) : (
            <Save size={18} />
          )}
          {saving ? "Saving…" : saved ? "Saved" : "Save note"}
        </button>
      </div>
    </div>
  );
}
