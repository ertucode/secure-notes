# Ciphernote

A browser-encrypted notes workspace built with TanStack Start, TanStack Router, and Tailwind CSS 4. GitHub is the source of truth.

Encrypted GitHub blobs and their repository manifest are cached in IndexedDB.
Only blobs whose GitHub SHA has changed are downloaded during synchronization;
plaintext notes, attachment contents, passwords, and encryption keys are never
persisted in the cache.

## Development

Requires Node.js 22.12 or newer.

```bash
npm install
npm run dev
```
