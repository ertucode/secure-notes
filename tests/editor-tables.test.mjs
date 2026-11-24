import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
for (const key of ["window", "document", "navigator", "Node", "HTMLElement", "Element", "MutationObserver", "DOMParser", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "innerHeight", "innerWidth", "CustomEvent"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
for (const key of ["addEventListener", "removeEventListener", "dispatchEvent"]) {
  globalThis[key] = dom.window[key].bind(dom.window);
}
const { Editor, defaultValueCtx, editorViewCtx, rootCtx, serializerCtx, parserCtx } = await import("@milkdown/kit/core");
const { commonmark } = await import("@milkdown/kit/preset/commonmark");
const { gfm } = await import("@milkdown/kit/preset/gfm");
const { clipboard } = await import("@milkdown/kit/plugin/clipboard");
const { DOMParser, DOMSerializer, Slice } = await import("@milkdown/kit/prose/model");
const { history } = await import("@milkdown/kit/plugin/history");
const { undo } = await import("@milkdown/kit/prose/history");
const { CellSelection } = await import("@milkdown/kit/prose/tables");
const { TextSelection } = await import("@milkdown/kit/prose/state");
const { configureTableEditing, normalizeTableHTML, parseTabularText } = await import("../src/lib/editor-tables.ts");

const example = "Optimistic\tPessimistic\nMechanism\tVersion checks\tDatabase row locks\nLocks while reading\tNo\tUsually yes\nConcurrent modifications\tOne may fail\tOthers may wait\nBest for\tLow-contention data\tHigh-contention data\nSpring/JPA\t@Version\tLockModeType.PESSIMISTIC_WRITE";
const markdown = "| | Optimistic | Pessimistic |\n| --- | --- | --- |\n| Mechanism | Version checks | Database row locks |\n| Best for | Low contention | High contention |\n";

async function withEditor(initial, run) {
  const root = document.createElement("div");
  document.body.append(root);
  const editor = await Editor.make().config((ctx) => {
    configureTableEditing(ctx);
    ctx.set(rootCtx, root);
    ctx.set(defaultValueCtx, initial);
  }).use(commonmark).use(gfm).use(clipboard).use(history).create();
  try { await editor.action((ctx) => run(ctx, ctx.get(editorViewCtx))); }
  finally { await editor.destroy(); root.remove(); }
}

function paste(view, text, html = "") {
  const event = { clipboardData: { getData: (type) => type === "text/plain" ? text : type === "text/html" ? html : "" } };
  const container = document.createElement("div");
  container.innerHTML = view.someProp("transformPastedHTML", (transform) => transform(html, view)) || html;
  const slice = html ? DOMParser.fromSchema(view.state.schema).parseSlice(container) : Slice.empty;
  return view.someProp("handlePaste", (handler) => handler(view, event, slice));
}

function selectCells(view, rowIndex, from, to, endRow = rowIndex) {
  const rows = [];
  view.state.doc.descendants((node, pos) => {
    if (node.type.spec.tableRole === "row") {
      const cells = [];
      node.forEach((_cell, offset) => cells.push(pos + 1 + offset));
      rows.push(cells);
    }
  });
  view.dispatch(view.state.tr.setSelection(CellSelection.create(view.state.doc, rows[rowIndex][from], rows[endRow][to])));
}

function backspace(view) {
  const event = new window.KeyboardEvent("keydown", { key: "Backspace" });
  return view.someProp("handleKeyDown", (handler) => handler(view, event));
}

test("comparison TSV gains an empty corner and survives Markdown round-trip", async () => {
  await withEditor("", (ctx, view) => {
    assert.equal(paste(view, example), true);
    const table = view.state.doc.firstChild;
    assert.equal(table.type.name, "table");
    assert.equal(table.childCount, 6);
    for (let i = 0; i < table.childCount; i++) assert.equal(table.child(i).childCount, 3);
    assert.deepEqual(Array.from({ length: 3 }, (_, i) => table.firstChild.child(i).textContent), ["", "Optimistic", "Pessimistic"]);
    assert.equal(table.child(1).child(0).textContent, "Mechanism");
    const saved = ctx.get(serializerCtx)(view.state.doc);
    const restored = ctx.get(parserCtx)(saved);
    assert.deepEqual(restored.toJSON(), view.state.doc.toJSON());
    view.state.doc.check();
  });
});

test("explicit empty headers and trailing empty cells are not trimmed", () => {
  assert.deepEqual(parseTabularText("\tA\t\nName\t1\t\n"), [["", "A", ""], ["Name", "1", ""]]);
  assert.equal(parseTabularText("ordinary text\nmore text"), null);
});

test("rich HTML with mixed empty td/th headers preserves all columns and formatting", async () => {
  await withEditor("", (ctx, view) => {
    const html = '<table><tr><td></td><th><strong>Optimistic</strong></th><th>Pessimistic</th></tr><tr><th>Mechanism</th><td>Version checks</td><td>Database row locks</td></tr></table>';
    assert.equal(paste(view, example, html), true);
    const table = view.state.doc.firstChild;
    assert.equal(table.childCount, 2);
    assert.equal(table.firstChild.childCount, 3);
    assert.equal(table.firstChild.firstChild.textContent, "");
    assert.equal(table.firstChild.child(1).firstChild.firstChild.marks[0].type.name, "strong");
    const restored = ctx.get(parserCtx)(ctx.get(serializerCtx)(view.state.doc));
    assert.deepEqual(restored.toJSON(), view.state.doc.toJSON());
    view.state.doc.check();
  });
});

test("HTML with an omitted corner is padded on the left", () => {
  const html = normalizeTableHTML("<table><tr><th>A</th><th>B</th></tr><tr><td>Label</td><td>1</td><td>2</td></tr></table>");
  const container = document.createElement("div");
  container.innerHTML = html;
  assert.equal(container.querySelector("tr").cells.length, 3);
  assert.equal(container.querySelector("tr").cells[0].textContent, "");
});

test("Backspace deletes a fully selected body row instead of clearing its values", async () => {
  await withEditor(markdown, (_ctx, view) => {
    selectCells(view, 1, 0, 2);
    assert.equal(backspace(view), true);
    assert.equal(view.state.doc.firstChild.childCount, 2);
    assert.equal(view.state.doc.textContent.includes("Mechanism"), false);
    assert.equal(view.state.doc.textContent.includes("Best for"), true);
    view.state.doc.check();
  });
});

test("partial row selection still clears cells, without deleting the row", async () => {
  await withEditor(markdown, (_ctx, view) => {
    selectCells(view, 1, 0, 1);
    backspace(view);
    assert.equal(view.state.doc.firstChild.childCount, 3);
    assert.equal(view.state.doc.firstChild.child(1).child(0).textContent, "");
    assert.equal(view.state.doc.firstChild.child(1).child(2).textContent, "Database row locks");
  });
});

test("deleting the header promotes the next row and selecting all removes the table", async () => {
  await withEditor(markdown, (_ctx, view) => {
    selectCells(view, 0, 0, 2);
    assert.equal(backspace(view), true);
    assert.equal(view.state.doc.firstChild.childCount, 2);
    assert.equal(view.state.doc.firstChild.firstChild.type.name, "table_header_row");
    assert.equal(view.state.doc.firstChild.firstChild.firstChild.textContent, "Mechanism");
    view.state.doc.check();
    selectCells(view, 0, 0, 2, 1);
    assert.equal(backspace(view), true);
    assert.equal(view.state.doc.firstChild.type.name, "paragraph");
    view.state.doc.check();
  });
});

test("tab-separated text inside a code block stays text", async () => {
  await withEditor("```text\nx\n```", (_ctx, view) => {
    assert.equal(paste(view, example), undefined);
    assert.equal(view.state.doc.firstChild.type.name, "code_block");
  });
});

test("multiple fully selected rows are deleted together", async () => {
  await withEditor(markdown + "| Extra | A | B |\n", (_ctx, view) => {
    selectCells(view, 1, 0, 2, 2);
    assert.equal(backspace(view), true);
    assert.equal(view.state.doc.firstChild.childCount, 2);
    assert.equal(view.state.doc.firstChild.child(1).firstChild.textContent, "Extra");
    view.state.doc.check();
  });
});

test("pasting a TSV grid inserts rows below the focused row without replacing cells", async () => {
  await withEditor(markdown, (_ctx, view) => {
    selectCells(view, 1, 0, 0);
    const pos = view.state.selection.$anchorCell.pos + 2;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
    assert.equal(paste(view, "X\tY\tZ\nA\tB\tC"), true);
    assert.equal(view.state.doc.firstChild.childCount, 5);
    assert.equal(view.state.doc.firstChild.child(1).firstChild.textContent, "Mechanism");
    assert.equal(view.state.doc.firstChild.child(2).firstChild.textContent, "X");
    assert.equal(view.state.doc.firstChild.child(3).child(2).textContent, "C");
    assert.equal(view.state.doc.firstChild.child(4).firstChild.textContent, "Best for");
    view.state.doc.check();
  });
});

const retries = "| Retry | Delay before retry | With jitter |\n| :---- | :----------------- | :---------- |\n| 1 | 1 second | .5 |\n| 2 | 2 seconds | 1.2 |\n| 3 | 4 seconds | 3.7 |\n| 4 | 8 | 7.5 |\n";

test("copying the retry row and pasting from its final cell inserts an exact new row", async () => {
  await withEditor(retries, (ctx, view) => {
    const original = view.state.doc.toJSON();
    selectCells(view, 1, 0, 2);
    const copied = view.state.selection.content();
    const wrapper = document.createElement("div");
    wrapper.appendChild(DOMSerializer.fromSchema(view.state.schema).serializeFragment(copied.content));
    // The plain-text flavor can be paragraphs; the HTML carries the row grid.
    selectCells(view, 1, 2, 2);
    const pos = view.state.selection.$anchorCell.pos + 2;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
    assert.equal(paste(view, "1\n\n1 second\n\n.5", wrapper.innerHTML), true);
    const table = view.state.doc.firstChild;
    assert.equal(table.childCount, 6);
    for (let i = 0; i < table.childCount; i++) assert.equal(table.child(i).childCount, 3);
    assert.deepEqual(table.child(2).toJSON(), table.child(1).toJSON());
    assert.equal(table.child(3).firstChild.textContent, "2");
    assert.equal(table.child(5).firstChild.textContent, "4");
    view.state.doc.check();
    assert.deepEqual(ctx.get(parserCtx)(ctx.get(serializerCtx)(view.state.doc)).toJSON(), view.state.doc.toJSON());
    assert.equal(undo(view.state, view.dispatch), true);
    assert.deepEqual(view.state.doc.toJSON(), original);
  });
});

test("a single TSV row appends below the last row with empty cells intact", async () => {
  await withEditor(retries, (_ctx, view) => {
    selectCells(view, 4, 1, 1);
    assert.equal(paste(view, "5\t\t.9"), true);
    const table = view.state.doc.firstChild;
    assert.equal(table.childCount, 6);
    assert.equal(table.child(4).firstChild.textContent, "4");
    assert.deepEqual(Array.from({ length: 3 }, (_, i) => table.child(5).child(i).textContent), ["5", "", ".9"]);
    view.state.doc.check();
  });
});

test("copied HTML rows retain inline formatting and use body cells below the header", async () => {
  await withEditor(retries, (_ctx, view) => {
    selectCells(view, 0, 1, 1);
    const html = '<table><tbody><tr><td><p><strong>1</strong></p></td><td><p>1 second</p></td><td><p>.5</p></td></tr></tbody></table>';
    assert.equal(paste(view, "1\n\n1 second\n\n.5", html), true);
    const table = view.state.doc.firstChild;
    assert.equal(table.childCount, 6);
    assert.equal(table.firstChild.type.name, "table_header_row");
    assert.equal(table.child(1).type.name, "table_row");
    assert.equal(table.child(1).firstChild.firstChild.firstChild.marks[0].type.name, "strong");
    assert.equal(table.child(2).firstChild.textContent, "1");
    view.state.doc.check();
  });
});

test("deleting the final body row leaves a schema-valid table", async () => {
  await withEditor("| A | B |\n| --- | --- |\n| 1 | 2 |\n", (_ctx, view) => {
    selectCells(view, 1, 0, 1);
    assert.equal(backspace(view), true);
    assert.equal(view.state.doc.textContent.includes("1"), false);
    view.state.doc.check();
  });
});
