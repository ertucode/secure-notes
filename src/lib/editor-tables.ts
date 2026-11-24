import { editorViewOptionsCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import { DOMParser, Fragment, Slice, type Node as ProseNode } from "@milkdown/kit/prose/model";
import { TextSelection } from "@milkdown/kit/prose/state";
import { CellSelection, deleteRow, deleteTable, isInTable, selectedRect } from "@milkdown/kit/prose/tables";
import type { EditorView } from "@milkdown/kit/prose/view";

export function deleteSelectedTableRows(view: EditorView, event: KeyboardEvent) {
  if (!view.editable || event.key !== "Backspace" || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  const { state } = view;
  if (!(state.selection instanceof CellSelection) || !state.selection.isRowSelection()) return false;
  const rect = selectedRect(state);
  if (rect.top === 0 && rect.bottom === rect.map.height)
    return deleteTable(state, view.dispatch);

  // Milkdown requires a distinct header row. Promote the first remaining row
  // rather than letting ProseMirror insert an empty header to repair the schema.
  if (rect.top === 0) {
    const rows = [];
    const { table_header_row, table_header } = state.schema.nodes;
    for (let index = rect.bottom; index < rect.table.childCount; index++) {
      const row = rect.table.child(index);
      rows.push(index === rect.bottom
        ? table_header_row!.create(row.attrs, Array.from({ length: row.childCount }, (_, i) => {
            const cell = row.child(i);
            return table_header!.create(cell.attrs, cell.content);
          }))
        : row);
    }
    const table = rect.table.type.createAndFill(rect.table.attrs, Fragment.from(rows));
    if (!table) return false;
    view.dispatch(state.tr.replaceWith(rect.tableStart - 1, rect.tableStart - 1 + rect.table.nodeSize, table).scrollIntoView());
    return true;
  }
  return deleteRow(state, (tr) => view.dispatch(tr.scrollIntoView()));
}

// A short first row commonly means the empty corner cell was omitted while
// copying a comparison table. Do not trim tabs: they represent empty cells.
export function parseTabularText(text: string): string[][] | null {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "").split("\n");
  if (lines.length < 2 || lines.some((line) => !line.includes("\t"))) return null;
  const rows = lines.map((line) => line.split("\t"));
  const width = Math.max(...rows.map((row) => row.length));
  if (rows[0]!.length < width) rows[0]!.unshift(...Array(width - rows[0]!.length).fill(""));
  for (const row of rows) while (row.length < width) row.push("");
  return rows;
}

export function normalizeTableHTML(html: string): string {
  if (!/<table[\s>]/i.test(html)) return html;
  const template = document.createElement("template");
  template.innerHTML = html;
  for (const table of template.content.querySelectorAll("table")) {
    const rows = Array.from(table.rows);
    const first = rows[0];
    if (!first) continue;
    // Merged cells already describe their own grid; leave their layout intact.
    if (rows.some((row) => Array.from(row.cells).some((cell) => cell.colSpan > 1 || cell.rowSpan > 1))) continue;
    const width = Math.max(...rows.map((row) => row.cells.length));
    while (first.cells.length < width) first.insertBefore(document.createElement("th"), first.firstChild);
    // Mixed <td>/<th> rows otherwise split into incompatible row types.
    // Row-label <th> cells in the body must remain ordinary body cells too.
    for (const row of rows) {
      const tag = row === first ? "th" : "td";
      for (const cell of Array.from(row.cells)) {
        if (cell.tagName.toLowerCase() === tag) continue;
        const replacement = document.createElement(tag);
        for (const attribute of Array.from(cell.attributes)) replacement.setAttribute(attribute.name, attribute.value);
        replacement.append(...Array.from(cell.childNodes));
        cell.replaceWith(replacement);
      }
    }
    for (const row of rows.slice(1)) while (row.cells.length < width) row.insertCell();
  }
  return template.innerHTML;
}

function insertPastedTableRows(view: EditorView, event: ClipboardEvent, slice: Slice) {
  if (!isInTable(view.state) || !event.clipboardData) return false;
  const { state } = view;
  const rect = selectedRect(state);
  const width = rect.map.width;
  const paragraph = state.schema.nodes.paragraph!;
  const parser = DOMParser.fromSchema(state.schema);
  let rows: ProseNode[][] = [];
  const html = event.clipboardData.getData("text/html");

  if (html) {
    // Read the original clipboard, before header normalization/schema repair:
    // a copied body row has no header and is not a standalone Markdown table.
    const template = document.createElement("template");
    template.innerHTML = html;
    const sourceRows = Array.from(template.content.querySelectorAll("tr"));
    if (sourceRows.length) {
      if (sourceRows.some((row) => row.cells.length !== width || Array.from(row.cells).some((cell) => cell.colSpan !== 1 || cell.rowSpan !== 1))) return false;
      rows = sourceRows.map((row) => Array.from(row.cells, (cell) =>
        parser.parse(cell, { topNode: paragraph.create() }),
      ));
    }
  } else {
    const text = event.clipboardData.getData("text/plain");
    const lines = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "").split("\n");
    if (lines.every((line) => line.includes("\t") && line.split("\t").length === width)) {
      rows = lines.map((line) => line.split("\t").map((value) =>
        paragraph.create(null, value ? state.schema.text(value) : undefined),
      ));
    }
  }
  if (!rows.length) {
    // Some clipboard integrations supply only a structured ProseMirror slice.
    const collect = (node: ProseNode) => {
      if (node.type.spec.tableRole === "row") {
        if (node.childCount !== width) return;
        rows.push(Array.from({ length: width }, (_, i) => node.child(i).firstChild!));
      } else node.forEach(collect);
    };
    slice.content.forEach(collect);
  }
  if (!rows.length) return false;

  const $focus = state.selection instanceof CellSelection
    ? state.selection.$headCell : state.selection.$head;
  let rowDepth = $focus.depth;
  while (rowDepth > 0 && $focus.node(rowDepth).type.spec.tableRole !== "row") rowDepth--;
  if (!rowDepth) return false;
  const position = $focus.after(rowDepth);
  const rowType = state.schema.nodes.table_row!;
  const cellType = state.schema.nodes.table_cell!;
  const inserted = rows.map((cells) => rowType.create(null, cells.map((content, index) =>
    cellType.create({ alignment: rect.table.firstChild!.child(index).attrs.alignment }, content),
  )));
  const tr = state.tr.insert(position, Fragment.from(inserted));
  tr.setSelection(TextSelection.near(tr.doc.resolve(position + 3)));
  view.dispatch(tr.setMeta("paste", true).setMeta("uiEvent", "paste").scrollIntoView());
  return true;
}

export function configureTableEditing(ctx: Ctx) {
  // Direct view props run before GFM's tableEditing plugin, whose default
  // Backspace behavior clears a CellSelection instead of deleting its rows.
  ctx.update(editorViewOptionsCtx, (previous) => ({
    ...previous,
    handleKeyDown(view, event) {
      return deleteSelectedTableRows(view, event) || previous.handleKeyDown?.(view, event) || false;
    },
    transformPastedHTML(html, view) {
      return normalizeTableHTML(previous.transformPastedHTML?.(html, view) ?? html);
    },
    handlePaste(view, event, slice) {
      const data = event.clipboardData;
      const { $from } = view.state.selection;
      if (view.editable && !$from.parent.type.spec.code && insertPastedTableRows(view, event, slice)) return true;
      if (view.editable && data && !$from.parent.type.spec.code && !$from.marks().some((mark) => mark.type.spec.code) && !data.getData("text/html")) {
        const rows = parseTabularText(data.getData("text/plain"));
        if (rows) {
          const table = document.createElement("table");
          rows.forEach((cells, index) => {
            const row = table.insertRow();
            cells.forEach((text) => {
              const cell = document.createElement(index === 0 ? "th" : "td");
              cell.textContent = text;
              row.appendChild(cell);
            });
          });
          const wrapper = document.createElement("div");
          wrapper.appendChild(table);
          const doc = DOMParser.fromSchema(view.state.schema).parse(wrapper);
          const tableSlice = new Slice(doc.content, 0, 0);
          // Let ProseMirror merge a pasted grid into an existing table instead
          // of trying to nest a table inside one of its paragraph-only cells.
          if (isInTable(view.state)) {
            const startRow = selectedRect(view.state).top;
            const schema = view.state.schema;
            const source = doc.firstChild!;
            const gridRows = rows.map((_cells, index) => {
              const isHeader = startRow + index === 0;
              const rowType = schema.nodes[isHeader ? "table_header_row" : "table_row"]!;
              const cellType = schema.nodes[isHeader ? "table_header" : "table_cell"]!;
              const sourceRow = source.child(index);
              return rowType.create(null, Array.from({ length: sourceRow.childCount }, (_, i) => {
                const cell = sourceRow.child(i);
                return cellType.create(cell.attrs, cell.content);
              }));
            });
            const grid = new Slice(Fragment.from(source.type.create(source.attrs, gridRows)), 0, 0);
            for (const plugin of view.state.plugins) {
              if (plugin.props.handlePaste?.call(plugin, view, event, grid)) return true;
            }
          }
          view.dispatch(view.state.tr.replaceSelection(tableSlice).scrollIntoView());
          return true;
        }
      }
      return previous.handlePaste?.(view, event, slice) || false;
    },
  }));
}
