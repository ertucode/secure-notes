import assert from "node:assert/strict";
import test from "node:test";
import { Schema } from "@milkdown/kit/prose/model";
import { AllSelection, EditorState, NodeSelection, TextSelection } from "@milkdown/kit/prose/state";
import { history, undo } from "@milkdown/kit/prose/history";
import { imageCompressionTransaction, selectedImages } from "../src/lib/editor-image-compression.ts";

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "inline*" },
    text: { group: "inline" },
    image: { inline: true, group: "inline", attrs: { src: {}, alt: { default: "" } } },
  },
});
const image = (src) => schema.nodes.image.create({ src, alt: src });
function state() {
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.paragraph.create(null, [image("first"), schema.text(" between "), image("second")]),
    schema.nodes.paragraph.create(null, image("third")),
  ]);
  return EditorState.create({ doc, plugins: [history()] });
}

test("finds every fully selected image, including across paragraphs", () => {
  let s = state();
  s = s.apply(s.tr.setSelection(new AllSelection(s.doc)));
  assert.deepEqual(selectedImages(s).map((item) => item.source), ["first", "second", "third"]);
  s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 2, 12)));
  assert.deepEqual(selectedImages(s).map((item) => item.source), ["second"]);
  s = s.apply(s.tr.setSelection(NodeSelection.create(s.doc, 1)));
  assert.deepEqual(selectedImages(s).map((item) => item.source), ["first"]);
});

test("batch compression is one undoable edit and preserves image metadata", () => {
  let s = state();
  s = s.apply(s.tr.setSelection(new AllSelection(s.doc)));
  const original = s.doc;
  const images = selectedImages(s).map((item) => ({ ...item, size: 100 }));
  s = s.apply(imageCompressionTransaction(s, images, [
    { source: "compressed-first", size: 50 },
    { source: "compressed-second", size: 60 },
    { source: "compressed-third", size: 70 },
  ]));
  assert.deepEqual(selectedImages(s).map((item) => item.source), ["compressed-first", "compressed-second", "compressed-third"]);
  assert.equal(s.doc.nodeAt(1).attrs.alt, "first");
  assert.equal(undo(s, (tr) => { s = s.apply(tr); }), true);
  assert.ok(s.doc.eq(original));
});

test("larger results and unsupported images are skipped without blocking others", () => {
  let s = state();
  s = s.apply(s.tr.setSelection(new AllSelection(s.doc)));
  const images = selectedImages(s).map((item) => ({ ...item, size: 100 }));
  s = s.apply(imageCompressionTransaction(s, images, [
    { source: "smaller", size: 50 },
    { source: "larger", size: 150 },
    null,
  ]));
  assert.deepEqual(selectedImages(s).map((item) => item.source), ["smaller", "second", "third"]);
});

test("stale targets are rejected rather than overwriting a different image", () => {
  const s = state();
  assert.throws(() => imageCompressionTransaction(s, [
    { position: 1, source: "replaced-image", size: 100 },
  ], [{ source: "compressed", size: 50 }]), /image has changed/);
});
