import { editorStateOptionsCtx, prosePluginsCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import type { Node } from "@milkdown/kit/prose/model";
import { Plugin, Selection, TextSelection } from "@milkdown/kit/prose/state";

export function noteSelectionKey(repository: string, noteId: string) {
  return `ciphernote.noteSelection:${JSON.stringify([repository, noteId])}`;
}

export function copyNoteSelection(repository: string, fromId: string, toId: string) {
  try {
    const selection = sessionStorage.getItem(noteSelectionKey(repository, fromId));
    if (selection) sessionStorage.setItem(noteSelectionKey(repository, toId), selection);
  } catch {
    // Renaming a note should still work when storage is unavailable.
  }
}

function readSelection(key: string, doc: Node): Selection | undefined {
  try {
    const stored = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (!stored) return;
    if (stored.type === "text") {
      if (!Number.isSafeInteger(stored.anchor) || !Number.isSafeInteger(stored.head)) return;
      const clamp = (position: number) => Math.max(0, Math.min(position, doc.content.size));
      return TextSelection.between(doc.resolve(clamp(stored.anchor)), doc.resolve(clamp(stored.head)));
    }
    return Selection.fromJSON(doc, stored);
  } catch {
    // Unavailable storage, invalid JSON, or a selection in a changed document
    // must never prevent opening or editing the note.
    return;
  }
}

export function configureNoteSelection(ctx: Ctx, key: string) {
  let restored = false;
  ctx.update(editorStateOptionsCtx, (previous) => (options) => {
    const configured = previous(options);
    if (!configured.doc) return configured;
    const selection = readSelection(key, configured.doc);
    restored = Boolean(selection);
    return selection ? { ...configured, selection } : configured;
  });
  ctx.update(prosePluginsCtx, (plugins) => [...plugins, new Plugin({
    view(view) {
      const write = () => {
        try {
          sessionStorage.setItem(key, JSON.stringify(view.state.selection.toJSON()));
        } catch {
          // Cursor persistence is best-effort when storage is full or disabled.
        }
      };
      // Restore in the initial EditorState, not a document transaction: moving
      // the cursor must not produce drafts or become an undoable edit.
      const frame = restored ? window.requestAnimationFrame(() => {
        const active = document.activeElement;
        // Do not steal focus from the new-note title or another text input.
        if (active && !view.dom.contains(active) && active.matches("input, textarea, [contenteditable='true']")) return;
        view.focus(); // ProseMirror focuses without scrolling the page.
      }) : 0;
      window.addEventListener("pagehide", write);
      return {
        update(current, previous) {
          if (!current.state.selection.eq(previous.selection) || !current.state.doc.eq(previous.doc)) write();
        },
        destroy() {
          window.cancelAnimationFrame(frame);
          write();
          window.removeEventListener("pagehide", write);
        },
      };
    },
  })]);
}
