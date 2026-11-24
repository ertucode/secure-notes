import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { Schema } from "@milkdown/kit/prose/model";
import { EditorState } from "@milkdown/kit/prose/state";
import { EditorView } from "@milkdown/kit/prose/view";
import { immediateDraftUpdates } from "../src/lib/editor-draft-updates.ts";

test("reports typing and reverting synchronously, even when immediately unmounted", () => {
  const dom = new JSDOM("<div id='editor'></div>");
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  const schema = new Schema({ nodes: { doc: { content: "paragraph+" }, paragraph: { content: "text*", toDOM: () => ["p", 0] }, text: {} } });
  const updates = [];
  const view = new EditorView(document.querySelector("#editor"), {
    state: EditorState.create({ schema, plugins: [immediateDraftUpdates((doc) => doc.textContent, (value) => updates.push(value))] }),
  });
  view.dispatch(view.state.tr.insertText("x", 1));
  assert.deepEqual(updates, ["x"]);
  view.dispatch(view.state.tr.delete(1, 2));
  assert.deepEqual(updates, ["x", ""]);
  view.dispatch(view.state.tr.insertText("last keystroke", 1));
  view.destroy();
  assert.equal(updates.at(-1), "last keystroke");
});
