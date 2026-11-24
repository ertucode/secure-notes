import { editorViewOptionsCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import { closeHistory } from "@milkdown/kit/prose/history";
import { Plugin, PluginKey, TextSelection } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

function removeInlineCodeAtBoundary(view: EditorView, event: KeyboardEvent) {
  if (!view.editable || event.isComposing || event.key !== "Backspace" ||
      event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  const { state } = view;
  const { selection } = state;
  if (!(selection instanceof TextSelection) || !selection.empty) return false;
  const code = state.schema.marks.inlineCode;
  if (!code) return false;

  const { $from } = selection;
  const ranges: { from: number; to: number }[] = [];
  $from.parent.forEach((node, offset) => {
    if (!code.isInSet(node.marks)) return;
    const last = ranges.at(-1);
    if (last?.to === offset) last.to += node.nodeSize;
    else ranges.push({ from: offset, to: offset + node.nodeSize });
  });
  const range = ranges.find(({ from, to }) =>
    $from.parentOffset === from || $from.parentOffset === to,
  );
  if (!range) return false;

  // Remove formatting, not the character next to the caret. Unlike undoing an
  // input rule, this also works after clicking away or reopening a saved note.
  view.dispatch(closeHistory(state.tr)
    .removeMark($from.start() + range.from, $from.start() + range.to, code)
    .removeStoredMark(code)
    .scrollIntoView());
  return true;
}

export function configureMarkdownEditing(ctx: Ctx) {
  ctx.update(editorViewOptionsCtx, (previous) => ({
    ...previous,
    handleKeyDown(view, event) {
      return removeInlineCodeAtBoundary(view, event) || previous.handleKeyDown?.(view, event) || false;
    },
  }));
}

const focusKey = new PluginKey<boolean>("markdownEditingFocus");

// Heading syntax is a view decoration only: it never enters the document,
// Markdown serialization, clipboard content, or undo history.
export const activeHeadingSyntax = $prose(() => new Plugin<boolean>({
  key: focusKey,
  state: {
    init: () => false,
    apply: (tr, focused) => tr.getMeta(focusKey) ?? focused,
  },
  props: {
    handleDOMEvents: {
      focus(view) {
        view.dispatch(view.state.tr.setMeta(focusKey, true));
        return false;
      },
      blur(view) {
        view.dispatch(view.state.tr.setMeta(focusKey, false));
        return false;
      },
    },
    decorations(state) {
      if (!focusKey.getState(state)) return DecorationSet.empty;
      const { $from, $to } = state.selection;
      if ($from.parent.type.name !== "heading" || !$from.sameParent($to)) return DecorationSet.empty;
      const level = $from.parent.attrs.level as number;
      const position = $from.start();
      return DecorationSet.create(state.doc, [Decoration.widget(position, (view) => {
        const marker = document.createElement("span");
        marker.className = "markdown-heading-syntax";
        marker.textContent = `${"#".repeat(level)} `;
        marker.contentEditable = "false";
        marker.setAttribute("aria-hidden", "true");
        marker.title = "Place the cursor at the start and press Backspace to reduce the heading level";
        marker.addEventListener("mousedown", (event) => {
          event.preventDefault();
          view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, position)));
          view.focus();
        });
        return marker;
      }, { side: -1, key: `heading-syntax-${position}-${level}` })]);
    },
  },
}));
