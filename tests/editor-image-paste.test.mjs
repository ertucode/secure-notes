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
// jsdom does not implement these browser event classes.
globalThis.ClipboardEvent = class extends dom.window.Event {
  constructor(data) {
    super("paste", { cancelable: true });
    this.clipboardData = data;
  }
};
globalThis.DragEvent = class extends dom.window.Event {};

const { Editor, defaultValueCtx, editorViewCtx, rootCtx, serializerCtx } =
  await import("@milkdown/kit/core");
const { commonmark } = await import("@milkdown/kit/preset/commonmark");
const { clipboard } = await import("@milkdown/kit/plugin/clipboard");
const { upload, uploadConfig } = await import("@milkdown/kit/plugin/upload");
const { DOMParser: ProseParser } = await import("@milkdown/kit/prose/model");

const source = "data:image/png;base64,iVBORw0KGgo=";

async function withEditor(run) {
  const root = document.createElement("div");
  document.body.appendChild(root);
  let uploads = 0;
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, "");
      ctx.update(uploadConfig.key, (config) => ({
        ...config,
        enableHtmlFileUploader: true,
        uploader: async (files, schema) => {
          uploads += files.length;
          return [...files].map((file) => schema.nodes.image.create({
            src: source, alt: file.name,
          }));
        },
      }));
    })
    .use(commonmark)
    .use(upload)
    .use(clipboard)
    .create();
  try {
    await run(editor, () => uploads);
  } finally {
    await editor.destroy();
    root.remove();
  }
}

function paste(editor, html, files = [], plain = "") {
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const event = new ClipboardEvent({
      files,
      getData: (type) => type === "text/html" ? html : type === "text/plain" ? plain : "",
    });
    const container = document.createElement("div");
    container.innerHTML = html;
    const slice = ProseParser.fromSchema(view.state.schema).parseSlice(container);
    view.someProp("handlePaste", (handler) => handler(view, event, slice));
  });
}

test("browser Copy image uploads clipboard bytes instead of pasting the remote HTML URL", async () => {
  await withEditor(async (editor, uploads) => {
    const file = new dom.window.File(["image bytes"], "image.png", { type: "image/png" });
    paste(editor, '<img src="http://example.com/geoid.jpg" alt="Department of Physics">', [file]);
    // Upload completion is asynchronous, as in the editor.
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(uploads(), 1);
    editor.action((ctx) => {
      const doc = ctx.get(editorViewCtx).state.doc;
      const images = [];
      doc.descendants((node) => {
        if (node.type.name === "image") images.push(node);
      });
      assert.equal(images.length, 1);
      assert.equal(images[0].attrs.src, source);
      const saved = ctx.get(serializerCtx)(doc);
      assert.ok(saved.includes(source));
      assert.ok(!saved.includes("example.com"));
    });
  });
});

test("image-only clipboard paste still uploads without HTML", async () => {
  await withEditor(async (editor, uploads) => {
    const file = new dom.window.File(["image bytes"], "image.png", { type: "image/png" });
    paste(editor, "", [file]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(uploads(), 1);
    editor.action((ctx) => {
      assert.ok(ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc).includes(source));
    });
  });
});

test("ordinary rich text falls through to the clipboard handler", async () => {
  await withEditor(async (editor, uploads) => {
    paste(editor, "<p><strong>Important</strong></p>", [], "Important");
    assert.equal(uploads(), 0);
    editor.action((ctx) => {
      const text = ctx.get(editorViewCtx).state.doc.firstChild.firstChild;
      assert.equal(text.text, "Important");
      assert.equal(text.marks[0].type.name, "strong");
    });
  });
});
