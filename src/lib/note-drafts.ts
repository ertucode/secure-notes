const SESSION_KEY = "ciphernote.draftSession";
const DATABASE_NAME = "ciphernote-drafts";
const STORE = "drafts";

export type NoteDraft = {
  title: string;
  content: string;
  attachments: Record<string, string>;
  tags: string;
};

export function sameNoteDraft(left: NoteDraft, right: NoteDraft) {
  const tags = (value: string) => value.split(",").map((tag) => tag.trim()).filter(Boolean);
  if (left.title !== right.title ||
      JSON.stringify(tags(left.tags)) !== JSON.stringify(tags(right.tags))) return false;
  // Attachment IDs can change when migrating old inline images. Compare their
  // sources, and ignore unused entries left behind after deleting an image.
  const parts = (draft: NoteDraft) => draft.content.trimEnd().split(/attachment:([^\s)]+)/g);
  const a = parts(left);
  const b = parts(right);
  return a.length === b.length && a.every((part, index) => index % 2
    ? (left.attachments[part] ?? part) === (right.attachments[b[index]] ?? b[index])
    : part === b[index]);
}

type DraftSession = { id: string; secret: number[] };
type StoredDraft = { id: string; iv: Uint8Array; ciphertext: ArrayBuffer; updatedAt: number };
let databasePromise: Promise<IDBDatabase> | undefined;
let session: DraftSession | undefined;
let generation = 0;
const memoryDrafts = new Map<string, NoteDraft>();
const memoryId = (repository: string, noteId: string) => JSON.stringify([repository, noteId]);

export function getNoteDraftFromMemory(repository: string, noteId: string): NoteDraft | undefined {
  return memoryDrafts.get(memoryId(repository, noteId));
}

// Serialize writes and removals so a slow image encryption cannot resurrect a
// draft after Save, or overwrite a newer edit.
let pending: Promise<unknown> = Promise.resolve();

function draftSession() {
  if (session) return session;
  const stored = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "null");
  if (
    typeof stored?.id === "string" && Array.isArray(stored.secret) &&
    stored.secret.length === 32 && stored.secret.every((n: unknown) =>
      typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 255)
  ) {
    session = stored;
  } else {
    const created = {
      id: crypto.randomUUID(),
      secret: Array.from(crypto.getRandomValues(new Uint8Array(32))),
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(created));
    session = created;
  }
  return session!;
}

function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        databasePromise = undefined;
      };
      // Closed tabs lose their key. Expire their now-unrecoverable ciphertext.
      const transaction = database.transaction(STORE, "readwrite");
      const cursor = transaction.objectStore(STORE).openCursor();
      cursor.onsuccess = () => {
        const item = cursor.result;
        if (!item) return;
        if (item.value.updatedAt < Date.now() - 7 * 24 * 60 * 60 * 1000) item.delete();
        item.continue();
      };
      resolve(database);
    };
    request.onerror = () => {
      databasePromise = undefined;
      reject(request.error);
    };
    request.onblocked = () => {
      databasePromise = undefined;
      reject(new Error("Local draft storage is blocked."));
    };
  });
  return databasePromise;
}

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = pending.then(operation);
  pending = result.catch(() => {});
  return result;
}

async function identity(repository: string, noteId: string) {
  const { id, secret } = draftSession();
  const key = await crypto.subtle.importKey(
    "raw", new Uint8Array(secret), "AES-GCM", false, ["encrypt", "decrypt"],
  );
  return { id: JSON.stringify([id, repository, noteId]), key };
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = transaction.onabort = () =>
      reject(transaction.error ?? new Error("Local draft storage failed."));
  });
}

export function writeNoteDraft(repository: string, noteId: string, draft: NoteDraft) {
  // Keep navigation safe even when disk storage is full or disabled. Coalesce
  // superseded edits before serializing potentially large image attachments.
  const snapshot = { ...draft, attachments: { ...draft.attachments } };
  const cacheId = memoryId(repository, noteId);
  memoryDrafts.set(cacheId, snapshot);
  const currentGeneration = generation;
  return enqueue(async () => {
    if (currentGeneration !== generation || memoryDrafts.get(cacheId) !== snapshot) return;
    const plaintext = new TextEncoder().encode(JSON.stringify(snapshot));
    const { id, key } = await identity(repository, noteId);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(id) }, key, plaintext,
    );
    const database = await openDatabase();
    if (currentGeneration !== generation) return;
    const transaction = database.transaction(STORE, "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore(STORE).put({ id, iv, ciphertext, updatedAt: Date.now() } satisfies StoredDraft);
    await done;
  });
}

export function readNoteDraft(repository: string, noteId: string): Promise<NoteDraft | null> {
  const memory = memoryDrafts.get(memoryId(repository, noteId));
  if (memory) return Promise.resolve(memory);
  return enqueue(async () => {
    const { id, key } = await identity(repository, noteId);
    const database = await openDatabase();
    const transaction = database.transaction(STORE, "readonly");
    const done = transactionDone(transaction);
    const request = transaction.objectStore(STORE).get(id);
    const stored = await new Promise<StoredDraft | undefined>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await done;
    if (!stored) return null;
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: stored.iv as Uint8Array<ArrayBuffer>, additionalData: new TextEncoder().encode(id) },
      key, stored.ciphertext,
    );
    return JSON.parse(new TextDecoder().decode(plaintext)) as NoteDraft;
  });
}

export function preloadNoteDrafts(repository: string, noteIds: string[]): Promise<void> {
  if (noteIds.length === 0) return Promise.resolve();
  return enqueue(async () => {
    const database = await openDatabase();
    const transaction = database.transaction(STORE, "readonly");
    const done = transactionDone(transaction);
    const request = transaction.objectStore(STORE).getAll();
    const allStored = await new Promise<StoredDraft[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result ?? []);
      request.onerror = () => reject(request.error);
    });
    await done;

    const noteIdSet = new Set(noteIds);
    const { id: sessionId, secret } = draftSession();
    const key = await crypto.subtle.importKey(
      "raw", new Uint8Array(secret), "AES-GCM", false, ["decrypt"],
    );
    for (const stored of allStored) {
      const [tab, repo, noteId] = JSON.parse(String(stored.id));
      if (tab !== sessionId || repo !== repository || !noteIdSet.has(noteId)) continue;
      const cacheId = memoryId(repository, noteId);
      if (memoryDrafts.has(cacheId)) continue;
      const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: stored.iv as Uint8Array<ArrayBuffer>, additionalData: new TextEncoder().encode(stored.id) },
        key, stored.ciphertext,
      );
      memoryDrafts.set(cacheId, JSON.parse(new TextDecoder().decode(plaintext)) as NoteDraft);
    }
  });
}

export function removeNoteDraft(repository: string, noteId: string) {
  memoryDrafts.delete(memoryId(repository, noteId));
  return enqueue(async () => {
    const { id } = await identity(repository, noteId);
    const database = await openDatabase();
    const transaction = database.transaction(STORE, "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore(STORE).delete(id);
    await done;
  });
}

export function clearNoteDraftSession() {
  generation += 1;
  session = undefined;
  memoryDrafts.clear();
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Storage may have become unavailable since unlocking.
  }
}

export function listNoteDraftIds(repository: string): Promise<string[]> {
  return enqueue(async () => {
    const { id: sessionId } = draftSession();
    const database = await openDatabase();
    const transaction = database.transaction(STORE, "readonly");
    const done = transactionDone(transaction);
    const request = transaction.objectStore(STORE).getAllKeys();
    const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await done;
    return keys.flatMap((key) => {
      const [tab, repo, noteId] = JSON.parse(String(key));
      return tab === sessionId && repo === repository ? [noteId] : [];
    });
  });
}
