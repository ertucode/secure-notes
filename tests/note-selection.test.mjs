import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://notes.example", pretendToBeVisual: true,
});
for (const key of [
  "window", "document", "navigator", "Node", "HTMLElement", "Element",
  "MutationObserver", "DOMParser", "getComputedStyle", "requestAnimationFrame",
  "cancelAnimationFrame", "innerHeight", "innerWidth", "sessionStorage", "CustomEvent",
]) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
}
for (const key of ["addEventListener", "removeEventListener", "dispatchEvent"]) {
  globalThis[key] = dom.window[key].bind(dom.window);
}

const { Editor, defaultValueCtx, editorViewCtx, rootCtx } = await import("@milkdown/kit/core");
const { commonmark } = await import("@milkdown/kit/preset/commonmark");
const { TextSelection, NodeSelection, AllSelection } = await import("@milkdown/kit/prose/state");
const { configureNoteSelection, noteSelectionKey } = await import("../src/lib/note-selection.ts");
const { markdownDraftUpdates } = await import("../src/lib/editor-draft-updates.ts");

async function openNote(key, markdown = "First paragraph\n\nSecond paragraph", configure = configureNoteSelection) {
  const root = document.createElement("div");
  document.body.appendChild(root);
  let changes = 0;
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, markdown);
      configure(ctx, key);
    })
    .use(commonmark)
    .use(markdownDraftUpdates(() => { changes += 1; }))
    .create();
  return {
    editor,
    view: editor.action((ctx) => ctx.get(editorViewCtx)),
    changes: () => changes,
    async close() { await editor.destroy(); root.remove(); },
  };
}

function select(view, anchor, head = anchor) {
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, anchor, head)));
}

test("switching notes restores each note's cursor independently without changing content", async () => {
  const a = noteSelectionKey("repo", "a");
  const b = noteSelectionKey("repo", "b");
  let note = await openNote(a);
  select(note.view, 8);
  assert.equal(note.changes(), 0);
  await note.close();
  note = await openNote(b);
  select(note.view, 3);
  await note.close();
  note = await openNote(a);
  assert.equal(note.view.state.selection.anchor, 8);
  assert.equal(note.view.state.selection.head, 8);
  assert.equal(note.changes(), 0);
  await note.close();
  note = await openNote(b);
  assert.equal(note.view.state.selection.head, 3);
  await note.close();
  note = await openNote(noteSelectionKey("different-repo", "a"));
  assert.equal(note.view.state.selection.head, 1);
  await note.close();
});

test("refresh restores a backwards multi-paragraph selection including its direction", async () => {
  const key = noteSelectionKey("repo", "refresh");
  let note = await openNote(key);
  select(note.view, 26, 4);
  window.dispatchEvent(new dom.window.Event("pagehide"));
  assert.deepEqual(JSON.parse(sessionStorage.getItem(key)), { type: "text", anchor: 26, head: 4 });
  await note.close();
  const refreshed = await import("../src/lib/note-selection.ts?refresh");
  note = await openNote(key, undefined, refreshed.configureNoteSelection);
  assert.equal(note.view.state.selection.anchor, 26);
  assert.equal(note.view.state.selection.head, 4);
  await new Promise((resolve) => window.requestAnimationFrame(resolve));
  assert.ok(note.view.hasFocus());
  assert.equal(window.getSelection().isCollapsed, false);
  assert.equal(note.changes(), 0);
  await note.close();
});

test("restoring the editor selection does not steal focus from a title input", async () => {
  const key = noteSelectionKey("repo", "title-focus");
  sessionStorage.setItem(key, JSON.stringify({ type: "text", anchor: 3, head: 5 }));
  const title = document.createElement("input");
  document.body.appendChild(title);
  title.focus();
  const note = await openNote(key);
  await new Promise((resolve) => window.requestAnimationFrame(resolve));
  assert.equal(document.activeElement, title);
  assert.equal(note.view.state.selection.anchor, 3);
  assert.equal(note.view.state.selection.head, 5);
  await note.close();
  title.remove();
});

test("typing saves the mapped caret and restores against the latest draft content", async () => {
  const key = noteSelectionKey("repo", "edited");
  let note = await openNote(key, "Original");
  select(note.view, 5);
  note.view.dispatch(note.view.state.tr.insertText(" new"));
  assert.equal(note.view.state.selection.head, 9);
  await note.close();
  note = await openNote(key, "Orig newinal");
  assert.equal(note.view.state.selection.head, 9);
  await note.close();
});

test("image node and select-all selections are restored", async () => {
  const key = noteSelectionKey("repo", "node");
  const markdown = "![image](attachment:image)";
  let note = await openNote(key, markdown);
  note.view.dispatch(note.view.state.tr.setSelection(NodeSelection.create(note.view.state.doc, 1)));
  await note.close();
  note = await openNote(key, markdown);
  assert.ok(note.view.state.selection instanceof NodeSelection);
  assert.equal(note.view.state.selection.from, 1);
  note.view.dispatch(note.view.state.tr.setSelection(new AllSelection(note.view.state.doc)));
  await note.close();
  note = await openNote(key, markdown);
  assert.ok(note.view.state.selection instanceof AllSelection);
  await note.close();
});

test("invalid or stale storage cannot prevent editing and out-of-range cursors are clamped", async () => {
  const key = noteSelectionKey("repo", "invalid");
  for (const stored of ["{broken", '{"type":"unknown"}', '{"type":"text","anchor":"bad","head":3}']) {
    sessionStorage.setItem(key, stored);
    const note = await openNote(key, "Short");
    select(note.view, 3);
    await note.close();
  }
  sessionStorage.setItem(key, JSON.stringify({ type: "text", anchor: 9999, head: -5 }));
  const note = await openNote(key, "Short");
  assert.equal(note.view.state.selection.anchor, 6);
  assert.equal(note.view.state.selection.head, 1);
  await note.close();
});

test("disabled storage does not interrupt editing or selection changes", async () => {
  const storage = globalThis.sessionStorage;
  globalThis.sessionStorage = { getItem() { throw Error("disabled"); }, setItem() { throw Error("disabled"); } };
  try {
    const note = await openNote("disabled", "Text");
    select(note.view, 3);
    note.view.dispatch(note.view.state.tr.insertText("x"));
    assert.equal(note.view.state.doc.textContent, "Texxt");
    await note.close();
  } finally {
    globalThis.sessionStorage = storage;
  }
});
