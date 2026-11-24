import type { EditorState } from "@milkdown/kit/prose/state";

export function selectedImages(state: EditorState) {
  const images: { position: number; source: string; alt: string }[] = [];
  const { from, to } = state.selection;
  state.doc.nodesBetween(from, to, (node, position) => {
    if (node.type.name === "image" && position >= from && position + node.nodeSize <= to) {
      images.push({ position, source: String(node.attrs.src), alt: String(node.attrs.alt ?? "") });
    }
  });
  return images;
}

// One transaction makes batch compression a single undoable edit. Never replace
// an image with a larger result, and validate every target before dispatching.
export function imageCompressionTransaction(
  state: EditorState,
  images: { position: number; source: string; size: number }[],
  results: ({ source: string; size: number } | null)[],
) {
  const tr = state.tr;
  images.forEach((image, index) => {
    const node = state.doc.nodeAt(image.position);
    if (node?.type.name !== "image" || node.attrs.src !== image.source)
      throw new Error("An image has changed. Close this dialog and select the images again.");
    const result = results[index];
    if (result && result.size < image.size) {
      tr.setNodeMarkup(image.position, undefined, { ...node.attrs, src: result.source });
    }
  });
  return tr;
}
