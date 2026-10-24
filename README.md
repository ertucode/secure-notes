# Ciphernote

A browser-encrypted notes workspace built with TanStack Start, TanStack Router, and Tailwind CSS 4. GitHub is the only persistence layer.

## Development

Requires Node.js 22.12 or newer.

```bash
npm install
npm run dev
```

## Production

The Nitro adapter targets a standard Node server without changing the TanStack Start application model.

```bash
npm run build
npm start
```

## Security and storage model

- The GitHub repository URL and fine-grained personal access token are stored in browser `localStorage`.
- The token is sent directly from the browser to `api.github.com`; it is never sent to the application server.
- The vault password is never persisted. It derives a non-extractable AES-256-GCM key that exists only in page memory and disappears when the page reloads or the vault is locked.
- `.ciphernote.json` stores only a random PBKDF2 salt, work factor, and encrypted verifier. These are not secrets.
- Notes are encrypted locally and stored as `notes/**/*.cnote` in GitHub. Decrypted note content is held only in page memory.
- GitHub requests use `cache: 'no-store'`.

Create a fine-grained token limited to the selected repository with **Contents: Read and write**. Because `localStorage` is readable by scripts on the same origin, deploy Ciphernote on a dedicated origin and maintain a strict dependency and content-security policy.
