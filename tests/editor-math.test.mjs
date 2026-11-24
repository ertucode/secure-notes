import assert from "node:assert/strict";
import test from "node:test";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import remarkMath from "remark-math";
import { renderMathPreview, transformMathBlocks } from "../src/lib/editor-math.ts";

const formula = String.raw`\text{delay}(n)=\operatorname{random}(0,\min(\text{cap},\text{base}\times 2^{n-1}))`;
const processor = unified().use(remarkParse).use(remarkMath).use(remarkStringify);

function parse(source) {
  const tree = processor.runSync(processor.parse(source), source);
  transformMathBlocks(tree, source);
  return tree;
}

test("accepts the exact bracket-delimited delay formula without losing escapes", () => {
  const tree = parse(`\\[\n${formula}\n\\]`);
  assert.deepEqual(tree.children, [{ type: "code", lang: "latex", value: formula }]);
  const html = renderMathPreview("latex", tree.children[0].value);
  assert.match(html, /katex-display/);
  assert.doesNotMatch(html, /katex-error/);
});

test("accepts standard display math and keeps inline math inline", () => {
  const tree = parse(`$$\n${formula}\n$$\n\nInline $x^2$.`);
  assert.equal(tree.children[0].lang, "latex");
  assert.equal(tree.children[0].value, formula);
  assert.equal(tree.children[1].children[1].type, "inlineMath");
});

test("display math survives Markdown serialization and reparsing", () => {
  const markdown = processor.stringify({
    type: "root",
    children: [{ type: "math", value: formula }],
  });
  assert.equal(parse(markdown).children[0].value, formula);
});

test("leaves code blocks, inline code, and ordinary escaped brackets alone", () => {
  const source = "```text\n\\[\nx^2\n\\]\n```\n\n`\\[x\\]`\n\nAn escaped \\[ bracket.";
  const before = processor.runSync(processor.parse(source), source);
  const after = structuredClone(before);
  transformMathBlocks(after, source);
  assert.deepEqual(after, before);
});

test("malformed LaTeX stays visible rather than throwing", () => {
  assert.match(renderMathPreview("latex", "\\notARealCommand{"), /katex-error/);
  assert.equal(renderMathPreview("javascript", "const x = 1"), null);
});
