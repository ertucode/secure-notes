# Ciphernote

A browser-encrypted notes workspace built with TanStack Start, TanStack Router, and Tailwind CSS 4. GitHub is the source of truth.

Encrypted GitHub blobs and their repository manifest are cached in IndexedDB.
Only blobs whose GitHub SHA has changed are downloaded during synchronization;
plaintext notes, attachment contents, passwords, and encryption keys are never
persisted in the cache.

The vault password is kept in tab-scoped session storage to unlock automatically
after refresh. Locking or disconnecting clears it; changing the password updates
it. Scripts running on this origin can access session storage. Note scroll
positions, caret positions, and selection ranges (including their direction)
are also remembered per repository and note for the tab session. Returning to
a note or refreshing restores its editor selection without marking it changed.

Unsaved note drafts (including images) survive note switching and refreshes.
Drafts are encrypted in a separate IndexedDB database; only their tab-specific
key is kept in session storage, avoiding its small size limit for images.
Amber dots mark notes that differ from their saved version. Saving or reverting
clears the draft. Drafts do not sync to GitHub until saved. Closing the tab,
locking, or disconnecting discards the draft key; save first to keep those edits.
If local storage fails, drafts still survive note switching in memory, but the
editor warns that refreshing may lose changes.

## Development

Requires Node.js 22.12 or newer.

```bash
npm install
npm run dev
```
