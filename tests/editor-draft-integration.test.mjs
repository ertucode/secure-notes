import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { indexedDB } from "fake-indexeddb";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://notes.example", pretendToBeVisual: true,
});
for (const key of [
  "window", "document", "navigator", "Node", "HTMLElement", "Element",
  "MutationObserver", "DOMParser", "getComputedStyle", "requestAnimationFrame",
  "cancelAnimationFrame", "innerHeight", "innerWidth", "sessionStorage", "CustomEvent",
]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
globalThis.indexedDB = indexedDB;
for (const key of ["addEventListener", "removeEventListener", "dispatchEvent"]) {
  globalThis[key] = dom.window[key].bind(dom.window);
}

const { Editor, defaultValueCtx, editorViewCtx, rootCtx, serializerCtx } = await import("@milkdown/kit/core");
const { commonmark } = await import("@milkdown/kit/preset/commonmark");
const { gfm } = await import("@milkdown/kit/preset/gfm");
const { listener } = await import("@milkdown/kit/plugin/listener");
const { markdownDraftUpdates } = await import("../src/lib/editor-draft-updates.ts");
const { readNoteDraft, writeNoteDraft, removeNoteDraft, sameNoteDraft } = await import("../src/lib/note-drafts.ts");

async function withEditor(initial, onChange, run) {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, initial);
    })
    .use(commonmark)
    .use(gfm)
    .use(markdownDraftUpdates(onChange))
    .use(listener)
    .create();
  try {
    await run(editor);
  } finally {
    await editor.destroy();
    root.remove();
  }
}

const snapshot = (content) => ({ title: "Note", content, attachments: {}, tags: "" });

test("real Milkdown typing immediately marks a draft dirty, restores it, and clears on revert", async () => {
  const initial = "- original";
  let dirty = false;
  let changed = "";
  const writes = [];
  await withEditor(initial, (markdown, normalize) => {
    changed = markdown;
    dirty = !sameNoteDraft(snapshot(markdown), snapshot(normalize(initial)));
    writes.push(dirty
      ? writeNoteDraft("repo", "note", snapshot(markdown))
      : removeNoteDraft("repo", "note"));
  }, async (editor) => {
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.insertText("new ", 3));
    });
    assert.equal(dirty, true);
    assert.match(changed, /new original/);
    await Promise.all(writes);
    // A module reload reads the IndexedDB copy, not the in-memory fallback.
    const refreshed = await import("../src/lib/note-drafts.ts?editor-refresh");
    assert.equal((await refreshed.readNoteDraft("repo", "note")).content, changed);
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.delete(3, 7));
    });
    assert.equal(dirty, false);
    await Promise.all(writes);
    assert.equal(await readNoteDraft("repo", "note"), null);
  });
});

test("real Milkdown saves its latest document and retains the final edit through immediate destroy/reopen", async () => {
  const initial = "Original";
  let changed = "";
  let saved = "";
  let normalizeLater;
  const writes = [];
  await withEditor(initial, (markdown, normalize) => {
    changed = markdown;
    normalizeLater = normalize;
    writes.push(writeNoteDraft("repo", "switch", snapshot(markdown)));
  }, async (editor) => {
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.insertText("Last edit ", 1));
    });
    // Same read used by MarkdownEditorHandle.getValue() when Save is pressed.
    saved = editor.action((ctx) => ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc));
    assert.match(saved, /Last edit Original/);
    assert.equal(saved, changed);
    assert.doesNotThrow(() => normalizeLater(initial));
    // No 200ms timeout before destroying the editor.
  });
  assert.doesNotThrow(() => normalizeLater(initial));
  await Promise.all(writes);
  const restored = await readNoteDraft("repo", "switch");
  assert.equal(restored.content, saved);
  await withEditor(restored.content, () => {}, async (editor) => {
    const reopened = editor.action((ctx) => ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc));
    assert.equal(reopened, saved);
  });
});
