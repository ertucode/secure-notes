import { codeBlockView } from "@milkdown/kit/component/code-block";
import { codeBlockSchema } from "@milkdown/kit/preset/commonmark";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { NodeSelection, Plugin, TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView, NodeView } from "@milkdown/kit/prose/view";
import { $prose, $view } from "@milkdown/kit/utils";

const toggles = new WeakMap<Node, () => void>();
let nextContentId = 0;

function isToggleShortcut(event: KeyboardEvent) {
  return event.key === "Enter" && event.shiftKey &&
    (event.metaKey || event.ctrlKey) && !event.altKey;
}

// Folding is view state only: it never changes the Markdown or undo history.
export function wrapCollapsibleCodeBlock(
  inner: NodeView,
  initialNode: ProseNode,
  view: EditorView,
  getPos: () => number | undefined,
): NodeView {
  let node = initialNode;
  let collapsed = false;
  let savedAnchor = 0;
  let savedHead = 0;
  const dom = document.createElement("div");
  dom.className = "collapsible-code-block";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "code-block-collapse-toggle";
  button.contentEditable = "false";
  const chevron = document.createElement("span");
  chevron.className = "code-block-collapse-chevron";
  chevron.textContent = "▾";
  chevron.setAttribute("aria-hidden", "true");
  const label = document.createElement("span");
  label.className = "code-block-collapse-summary";
  button.append(chevron, label);
  const content = document.createElement("div");
  content.className = "collapsible-code-block-content";
  content.id = `code-block-content-${++nextContentId}`;
  content.appendChild(inner.dom);
  button.setAttribute("aria-controls", content.id);
  dom.append(button, content);

  function refreshContentVisibility() {
    // Keep Milkdown's native toolbar mounted and usable while folding only
    // the code/preview below it. Never move Vue-managed toolbar elements.
    if (inner.dom instanceof HTMLElement && inner.dom.matches(".milkdown-code-block")) {
      for (const body of inner.dom.querySelectorAll<HTMLElement>(
        ":scope > .codemirror-host, :scope > .preview-panel, :scope > .milkdown-code-block-placeholder",
      )) body.hidden = collapsed;
      const tools = inner.dom.querySelector<HTMLElement>(":scope > .tools");
      if (tools) {
        const lines = node.textContent.split("\n").length;
        tools.dataset.lineCount = `${lines} ${lines === 1 ? "line" : "lines"}`;
      }
    } else if (inner.dom instanceof HTMLElement) {
      inner.dom.hidden = collapsed;
    }
  }

  function refresh() {
    refreshContentVisibility();
    dom.dataset.collapsed = String(collapsed);
    button.setAttribute("aria-expanded", String(!collapsed));
    const action = collapsed ? "Expand" : "Collapse";
    button.setAttribute("aria-label", `${action} code block`);
    button.title = `${action} code block (Ctrl/Cmd + Shift + Enter)`;
    const lines = node.textContent.split("\n").length;
    label.textContent = `${node.attrs.language || "Code"} · ${lines} ${lines === 1 ? "line" : "lines"}`;
  }

  function toggle() {
    const pos = getPos();
    if (pos === undefined) return;
    if (!collapsed) {
      const { anchor, head } = view.state.selection;
      const end = pos + node.nodeSize - 1;
      savedAnchor = anchor > pos && anchor <= end ? anchor - pos - 1 : 0;
      savedHead = head > pos && head <= end ? head - pos - 1 : savedAnchor;
      collapsed = true;
      refresh();
      // Do not leave the caret inside a hidden CodeMirror editor.
      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
      button.focus();
    } else {
      collapsed = false;
      refresh();
      const length = node.content.size;
      view.dispatch(view.state.tr.setSelection(TextSelection.create(
        view.state.doc,
        pos + 1 + Math.min(savedAnchor, length),
        pos + 1 + Math.min(savedHead, length),
      )));
      view.focus();
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (!isToggleShortcut(event)) return;
    event.preventDefault();
    event.stopPropagation();
    toggle();
  }

  // Capture before CodeMirror handles the shortcut or stops propagation.
  dom.addEventListener("keydown", onKeyDown, true);
  button.addEventListener("click", toggle);
  toggles.set(dom, toggle);
  // The lazy CodeMirror view mounts/unmounts its toolbar and bodies as it
  // enters/leaves the viewport. Apply folding to newly mounted bodies too.
  const observer = new MutationObserver(refreshContentVisibility);
  observer.observe(content, { childList: true, subtree: true });
  refresh();

  return {
    dom,
    update(next, decorations, innerDecorations) {
      if (next.type !== node.type) return false;
      if (inner.update && !inner.update(next, decorations, innerDecorations)) return false;
      node = next;
      refresh();
      return true;
    },
    setSelection(anchor, head, root) {
      // Navigating into folded code must never focus an invisible editor.
      if (collapsed) {
        collapsed = false;
        refresh();
      }
      inner.setSelection?.(anchor, head, root);
    },
    selectNode() {
      dom.classList.add("ProseMirror-selectednode");
      if (!collapsed) inner.selectNode?.();
    },
    deselectNode() {
      dom.classList.remove("ProseMirror-selectednode");
      inner.deselectNode?.();
    },
    stopEvent(event) {
      return button.contains(event.target as Node) || inner.stopEvent?.(event) || false;
    },
    ignoreMutation: () => true,
    destroy() {
      observer.disconnect();
      toggles.delete(dom);
      dom.removeEventListener("keydown", onKeyDown, true);
      button.removeEventListener("click", toggle);
      inner.destroy?.();
    },
  };
}

// The original constructor is resolved lazily, after all node views are ready.
// This preserves Milkdown's language picker, copy control, and math previews.
export const collapsibleCodeBlockView = $view(codeBlockSchema.node, () =>
  (node, view, getPos, decorations, innerDecorations) => wrapCollapsibleCodeBlock(
    codeBlockView.view(node, view, getPos, decorations, innerDecorations),
    node,
    view,
    getPos,
  ),
);

export const codeBlockCollapseKeys = $prose(() => new Plugin({
  props: {
    handleKeyDown(view, event) {
      if (!isToggleShortcut(event)) return false;
      const { selection } = view.state;
      let pos: number | undefined;
      if (selection instanceof NodeSelection && selection.node.type.name === "code_block") {
        pos = selection.from;
      } else {
        const { $from } = selection;
        for (let depth = $from.depth; depth > 0; depth -= 1) {
          if ($from.node(depth).type.name === "code_block") {
            pos = $from.before(depth);
            break;
          }
        }
      }
      if (pos === undefined) return false;
      const dom = view.nodeDOM(pos);
      const toggle = dom && toggles.get(dom);
      if (!toggle) return false;
      toggle();
      return true;
    },
  },
}));
