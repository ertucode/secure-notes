import { codeBlockSchema } from "@milkdown/kit/preset/commonmark";
import { parserCtx } from "@milkdown/kit/core";
import { nodeRule } from "@milkdown/kit/prose";
import { Slice, type Node as ProseNode } from "@milkdown/kit/prose/model";
import { Plugin } from "@milkdown/kit/prose/state";
import { textblockTypeInputRule } from "@milkdown/kit/prose/inputrules";
import type { Node } from "@milkdown/kit/transformer";
import { $inputRule, $node, $prose, $remark } from "@milkdown/kit/utils";
import katex from "katex";
import remarkMath from "remark-math";

type MathNode = Node & {
  children?: MathNode[];
  value?: string;
  lang?: string | null;
};

// Keep display math editable using the editor's existing code-block component.
// remark-math handles $$ blocks; the second plugin also accepts standalone
// \[ ... \] paragraphs, reading the original source so Markdown escaping
// cannot consume LaTeX commands such as \text or \times.
export const mathSyntax = $remark("mathSyntax", () => remarkMath);

export function transformMathBlocks(tree: MathNode, source: string) {
  function walk(parent: MathNode) {
    const children = parent.children;
    if (!children) return;
    children.forEach((node, index) => {
      let value: string | undefined;
      if (node.type === "math") {
        value = String(node.value ?? "");
      } else if (node.type === "paragraph") {
        const start = node.position?.start.offset;
        const end = node.position?.end.offset;
        if (start !== undefined && end !== undefined) {
          const raw = source.slice(start, end).trim();
          const match = raw.match(/^\\\[\s*([\s\S]*?)\s*\\\]$/);
          if (match) value = match[1];
        }
      }
      if (value !== undefined) {
        children[index] = { type: "code", lang: "latex", value };
      } else {
        walk(node);
      }
    });
  }
  walk(tree);
}

export const mathBlocks = $remark(
  "mathBlocks",
  () => () => (tree, file) => transformMathBlocks(tree, String(file)),
);

// Rich clipboard HTML bypasses Milkdown's Markdown parser. Prefer the raw text
// only when it actually parses into math, before the normal clipboard handler.
export const mathPaste = $prose((ctx) =>
  new Plugin({
    props: {
      handlePaste(view, event) {
        if (!view.editable || !event.clipboardData) return false;
        const { $from } = view.state.selection;
        if (
          $from.parent.type.spec.code ||
          $from.marks().some((mark) => mark.type.spec.code)
        )
          return false;

        const text = event.clipboardData.getData("text/plain");
        if (!text || (!text.includes("\\[") && !text.includes("$"))) return false;
        const doc = ctx.get(parserCtx)(text.replace(/\r\n?/g, "\n"));
        if (!doc) return false;
        let hasMath = false;
        let hasDisplayMath = false;
        doc.descendants((node: ProseNode) => {
          if (node.type.name === "inline_math") hasMath = true;
          if (node.type.name === "code_block" &&
              node.attrs.language?.toLowerCase() === "latex") {
            hasMath = true;
            hasDisplayMath = true;
          }
        });
        if (!hasMath) return false;

        // Keep display blocks closed so replacing a paragraph selection cannot
        // unwrap a math code block into ordinary paragraph text.
        view.dispatch(
          view.state.tr
            .replaceSelection(hasDisplayMath
              ? new Slice(doc.content, 0, 0)
              : Slice.maxOpen(doc.content))
            .scrollIntoView(),
        );
        return true;
      },
    },
  }),
);

export const mathCodeBlock = codeBlockSchema.extendSchema((previous) => (ctx) => {
  const base = previous(ctx);
  return {
    ...base,
    toMarkdown: {
      match: base.toMarkdown.match,
      runner: (state, node) => {
        if (node.attrs.language?.toLowerCase() === "latex") {
          state.addNode("math", undefined, node.textContent);
        } else {
          base.toMarkdown.runner(state, node);
        }
      },
    },
  };
});

export const inlineMath = $node("inline_math", () => ({
  group: "inline",
  inline: true,
  atom: true,
  attrs: { value: { default: "" } },
  parseDOM: [{
    tag: 'span[data-math="inline"]',
    getAttrs: (dom) => ({ value: (dom as HTMLElement).dataset.value ?? "" }),
  }],
  toDOM: (node) => {
    const dom = document.createElement("span");
    dom.dataset.math = "inline";
    dom.dataset.value = node.attrs.value;
    dom.title = node.attrs.value;
    katex.render(node.attrs.value, dom, { throwOnError: false, trust: false });
    return dom;
  },
  parseMarkdown: {
    match: (node) => node.type === "inlineMath",
    runner: (state, node, type) => {
      state.addNode(type, { value: node.value as string });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "inline_math",
    runner: (state, node) => {
      state.addNode("inlineMath", undefined, node.attrs.value);
    },
  },
}));

export const inlineMathInput = $inputRule((ctx) =>
  nodeRule(/\$([^$\n]+)\$$/, inlineMath.type(ctx), {
    getAttr: (match) => ({ value: match[1] }),
  }),
);

export const blockMathInput = $inputRule((ctx) =>
  textblockTypeInputRule(/^(?:\$\$|\\\[)\s$/, codeBlockSchema.type(ctx), () => ({
    language: "latex",
  })),
);

export function renderMathPreview(language: string, content: string) {
  if (language.toLowerCase() !== "latex") return null;
  return katex.renderToString(content, {
    displayMode: true,
    throwOnError: false,
    trust: false,
  });
}
