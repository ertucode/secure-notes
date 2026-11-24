import type { Node } from "@milkdown/kit/prose/model";
import { Plugin } from "@milkdown/kit/prose/state";
import { parserCtx, serializerCtx } from "@milkdown/kit/core";
import { $prose } from "@milkdown/kit/utils";

// Milkdown's markdownUpdated listener is debounced and cancels pending edits
// on destroy. Drafts must see each document change before navigation can occur.
export function immediateDraftUpdates(serialize: (doc: Node) => string, onChange: (markdown: string) => void) {
  return new Plugin({
    view: () => ({
      update(view, previous) {
        if (!view.state.doc.eq(previous.doc)) onChange(serialize(view.state.doc));
      },
    }),
  });
}

export function markdownDraftUpdates(
  onChange: (markdown: string, normalize: (markdown: string) => string) => void,
) {
  return $prose((ctx) => immediateDraftUpdates(
    // $prose waits for SchemaReady, not SerializerReady. Reading this slice
    // while constructing the plugin captures Milkdown's throwing placeholder.
    // Resolve it when the live editor actually reports a document update.
    (doc) => ctx.get(serializerCtx)(doc),
    (markdown) => {
      const serialize = ctx.get(serializerCtx);
      const parse = ctx.get(parserCtx);
      // React may run the baseline updater later, even after editor teardown.
      // Capture initialized functions, not a context that can be destroyed.
      onChange(markdown, (value) => serialize(parse(value)));
    },
  ));
}
