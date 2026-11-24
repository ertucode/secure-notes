import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
});
for (const key of [
  "window", "document", "navigator", "Node", "HTMLElement", "Element",
  "MutationObserver", "DOMParser", "getComputedStyle", "requestAnimationFrame",
  "cancelAnimationFrame", "innerHeight", "innerWidth", "CustomEvent",
]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
for (const key of ["addEventListener", "removeEventListener", "dispatchEvent"]) {
  globalThis[key] = dom.window[key].bind(dom.window);
}

const { Editor, defaultValueCtx, editorViewCtx, rootCtx, serializerCtx } =
  await import("@milkdown/kit/core");
const { commonmark } = await import("@milkdown/kit/preset/commonmark");
const { clipboard } = await import("@milkdown/kit/plugin/clipboard");
const { DOMParser } = await import("@milkdown/kit/prose/model");
const { TextSelection } = await import("@milkdown/kit/prose/state");
const math = await import("../src/lib/editor-math.ts");

const formula = String.raw`\text{delay}(n)=\operatorname{random}(0,\min(\text{cap},\text{base}\times 2^{n-1}))`;
const text = `\\[\n${formula}\n\\]`;

async function withEditor(initial, run) {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, initial);
    })
    .use(commonmark)
    .use(math.mathSyntax)
    .use(math.mathBlocks)
    .use(math.mathCodeBlock)
    .use(math.inlineMath)
    .use(math.mathPaste)
    .use(clipboard)
    .create();
  try {
    await run(editor);
  } finally {
    await editor.destroy();
    root.remove();
  }
}

function paste(editor, plain, html) {
  return editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const event = {
      clipboardData: {
        getData: (type) => type === "text/plain" ? plain : type === "text/html" ? html : "",
      },
    };
    // Mimic ProseMirror's rich HTML preprocessing and actual handler ordering.
    const container = document.createElement("div");
    container.innerHTML = html;
    const slice = DOMParser.fromSchema(view.state.schema).parseSlice(container);
    return view.someProp("handlePaste", (handler) => handler(view, event, slice));
  });
}

test("rich HTML clipboard paste creates a math block and survives saving/reopening", async () => {
  let saved;
  await withEditor("", (editor) => {
    const html = `<p>\\[<br>${formula}<br>\\]</p>`;
    assert.equal(paste(editor, text, html), true);
    editor.action((ctx) => {
      const doc = ctx.get(editorViewCtx).state.doc;
      assert.equal(doc.firstChild.type.name, "code_block");
      assert.equal(doc.firstChild.attrs.language, "latex");
      assert.equal(doc.firstChild.textContent, formula);
      saved = ctx.get(serializerCtx)(doc);
      assert.match(saved, /^\$\$/);
    });
  });
  await withEditor(saved, (editor) => editor.action((ctx) => {
    const node = ctx.get(editorViewCtx).state.doc.firstChild;
    assert.equal(node.type.name, "code_block");
    assert.equal(node.attrs.language, "latex");
    assert.equal(node.textContent, formula);
  }));
});

test("plain text math paste keeps the math block rather than unwrapping it", async () => {
  await withEditor("", (editor) => {
    assert.equal(paste(editor, text, ""), true);
    editor.action((ctx) => {
      const node = ctx.get(editorViewCtx).state.doc.firstChild;
      assert.equal(node.type.name, "code_block");
      assert.equal(node.textContent, formula);
    });
  });
});

test("ordinary rich text still uses the normal clipboard handler", async () => {
  await withEditor("", (editor) => {
    paste(editor, "Important", "<p><strong>Important</strong></p>");
    editor.action((ctx) => {
      const text = ctx.get(editorViewCtx).state.doc.firstChild.firstChild;
      assert.equal(text.text, "Important");
      assert.equal(text.marks[0].type.name, "strong");
    });
  });
});

test("inline math pastes into the current paragraph without splitting it", async () => {
  await withEditor("Before after", (editor) => {
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 8)));
    });
    paste(editor, "$x^2$", "<span>$x^2$</span>");
    editor.action((ctx) => {
      const doc = ctx.get(editorViewCtx).state.doc;
      assert.equal(doc.childCount, 1);
      assert.equal(doc.firstChild.child(0).text, "Before ");
      assert.equal(doc.firstChild.child(1).type.name, "inline_math");
      assert.equal(doc.firstChild.child(2).text, "after");
    });
  });
});

test("pasting a formula inside a code block does not convert it to math", async () => {
  await withEditor("```text\nexample\n```", (editor) => {
    paste(editor, text, "");
    editor.action((ctx) => {
      const node = ctx.get(editorViewCtx).state.doc.firstChild;
      assert.equal(node.type.name, "code_block");
      assert.equal(node.attrs.language, "text");
    });
  });
});
