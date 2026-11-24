import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
});
for (const key of [
  "window", "document", "navigator", "Node", "HTMLElement", "Element",
  "MutationObserver", "DOMParser", "getComputedStyle", "requestAnimationFrame",
  "cancelAnimationFrame", "innerHeight", "innerWidth", "CustomEvent", "SVGElement",
]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
globalThis.IntersectionObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
for (const key of ["addEventListener", "removeEventListener", "dispatchEvent"]) {
  globalThis[key] = dom.window[key].bind(dom.window);
}

const { Editor, defaultValueCtx, editorViewCtx, rootCtx, serializerCtx } =
  await import("@milkdown/kit/core");
const { commonmark, codeBlockSchema } = await import("@milkdown/kit/preset/commonmark");
const { TextSelection, NodeSelection } = await import("@milkdown/kit/prose/state");
const { $view } = await import("@milkdown/kit/utils");
const { codeBlockCollapseKeys, collapsibleCodeBlockView, wrapCollapsibleCodeBlock } =
  await import("../src/lib/collapsible-code-block.ts");
const { codeBlockComponent } = await import("@milkdown/kit/component/code-block");

const wrappedView = $view(codeBlockSchema.node, () => (node, view, getPos) => {
  // A lightweight inner editor lets us exercise the real ProseMirror selection,
  // event handling, and serialization without CodeMirror's layout dependency.
  const input = document.createElement("textarea");
  input.value = node.textContent;
  return wrapCollapsibleCodeBlock({
    dom: input,
    update(next) {
      input.value = next.textContent;
      return true;
    },
    setSelection(anchor, head) {
      input.focus();
      input.setSelectionRange(anchor, head);
    },
    stopEvent: () => true,
  }, node, view, getPos);
});

async function withEditor(initial, run, realCodeMirror = false) {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, initial);
    })
    .use(commonmark)
    .use(realCodeMirror ? [...codeBlockComponent, collapsibleCodeBlockView] : wrappedView)
    .use(codeBlockCollapseKeys)
    .create();
  try {
    await run(editor, root);
  } finally {
    await editor.destroy();
    root.remove();
  }
}

function shortcut(target, modifier = "ctrlKey") {
  const event = new dom.window.KeyboardEvent("keydown", {
    key: "Enter", shiftKey: true, [modifier]: true, bubbles: true, cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

function codeBody(content) {
  return content.querySelector(".codemirror-host, textarea, .milkdown-code-block-placeholder");
}

test("button folds and unfolds code without changing Markdown or document", async () => {
  await withEditor("```js\nconst x = 1;\nconsole.log(x);\n```", (editor, root) => {
    const button = root.querySelector(".code-block-collapse-toggle");
    const content = root.querySelector(".collapsible-code-block-content");
    const original = editor.action((ctx) => {
      const doc = ctx.get(editorViewCtx).state.doc;
      return { json: doc.toJSON(), markdown: ctx.get(serializerCtx)(doc) };
    });
    assert.equal(button.textContent, "▾js · 2 lines");
    assert.equal(button.getAttribute("aria-expanded"), "true");
    button.click();
    assert.equal(codeBody(content).hidden, true);
    assert.equal(button.getAttribute("aria-expanded"), "false");
    assert.equal(button.getAttribute("aria-label"), "Expand code block");
    assert.equal(document.activeElement, button);
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      assert.ok(view.state.selection instanceof NodeSelection);
      assert.deepEqual(view.state.doc.toJSON(), original.json);
      assert.equal(ctx.get(serializerCtx)(view.state.doc), original.markdown);
    });
    button.click();
    assert.equal(codeBody(content).hidden, false);
    assert.equal(button.getAttribute("aria-expanded"), "true");
  });
});

test("Ctrl/Cmd + Shift + Enter works inside the embedded editor and folded header", async () => {
  await withEditor("```js\ncode\n```", (_editor, root) => {
    const input = root.querySelector("textarea");
    const button = root.querySelector("button");
    const content = root.querySelector(".collapsible-code-block-content");
    assert.equal(shortcut(input).defaultPrevented, true);
    assert.equal(codeBody(content).hidden, true);
    assert.equal(shortcut(button, "metaKey").defaultPrevented, true);
    assert.equal(codeBody(content).hidden, false);
  });
});

test("outer editor shortcut toggles the selected block and restores its caret", async () => {
  await withEditor("```js\nabcdef\n```", (editor, root) => {
    const view = editor.action((ctx) => ctx.get(editorViewCtx));
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 4)));
    shortcut(view.dom);
    assert.equal(codeBody(root.querySelector(".collapsible-code-block-content")).hidden, true);
    shortcut(view.dom);
    assert.equal(codeBody(root.querySelector(".collapsible-code-block-content")).hidden, false);
    assert.equal(view.state.selection.anchor, 4);
  });
});

test("blocks fold independently and the shortcut leaves normal paragraphs alone", async () => {
  await withEditor("Intro\n\n```js\none\n```\n\n```css\ntwo\n```", (editor, root) => {
    const buttons = root.querySelectorAll(".code-block-collapse-toggle");
    const contents = root.querySelectorAll(".collapsible-code-block-content");
    buttons[0].click();
    assert.equal(codeBody(contents[0]).hidden, true);
    assert.equal(codeBody(contents[1]).hidden, false);
    const view = editor.action((ctx) => ctx.get(editorViewCtx));
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
    assert.equal(shortcut(view.dom).defaultPrevented, false);
    assert.equal(codeBody(contents[0]).hidden, true);
  });
});

test("block summary updates after code and language changes", async () => {
  await withEditor("```js\none\n```", (editor, root) => {
    const view = editor.action((ctx) => ctx.get(editorViewCtx));
    view.dispatch(view.state.tr.insertText("\ntwo", 4).setNodeAttribute(0, "language", "ts"));
    assert.equal(root.querySelector(".code-block-collapse-toggle").textContent, "▾ts · 2 lines");
  });
});

test("real Milkdown CodeMirror view expands, edits, and folds with the shortcut", async () => {
  await withEditor("```js\nconst x = 1;\n```", async (editor, root) => {
    const button = root.querySelector(".code-block-collapse-toggle");
    const content = root.querySelector(".collapsible-code-block-content");
    button.click();
    assert.equal(codeBody(content).hidden, true);
    button.click();
    assert.equal(codeBody(content).hidden, false);
    assert.ok(root.querySelector(".cm-editor"));
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.insertText("\nconsole.log(x);", view.state.doc.firstChild.nodeSize - 1));
    });
    // Vue mounts its toolbar asynchronously.
    await Promise.resolve();
    assert.ok(root.querySelector(".milkdown-code-block .tools"));
    shortcut(root.querySelector(".cm-content"));
    assert.equal(codeBody(content).hidden, true);
    const toolbar = root.querySelector(".milkdown-code-block .tools");
    assert.equal(content.hidden, false);
    assert.equal(toolbar.hidden, false);
    assert.ok(toolbar.querySelector(".language-button"));
    assert.ok(toolbar.querySelector(".tools-button-group button"));
    assert.equal(toolbar.dataset.lineCount, "2 lines");
    editor.action((ctx) => {
      assert.equal(ctx.get(editorViewCtx).state.doc.firstChild.textContent, "const x = 1;\nconsole.log(x);");
    });
  }, true);
});
