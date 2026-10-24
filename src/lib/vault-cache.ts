import type { RepositoryFile } from "./github";

const DATABASE_NAME = "ciphernote-cache";
const DATABASE_VERSION = 2;
const SNAPSHOTS_STORE = "snapshots";
const BLOBS_STORE = "blobs";

export type CachedConfigFile = { content: string; sha: string } | null;

export type VaultCacheSnapshot = {
  id: string;
  headSha: string;
  configFile: CachedConfigFile;
  vaultFiles: RepositoryFile[];
  updatedAt: string;
};

type CachedBlob = {
  id: string;
  vaultId: string;
  sha: string;
  content: string;
  updatedAt: string;
};

let databasePromise: Promise<IDBDatabase> | null = null;

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("The local cache transaction was aborted."));
  });
}

function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(SNAPSHOTS_STORE)) {
        database.createObjectStore(SNAPSHOTS_STORE, { keyPath: "id" });
      }
      const blobs = database.objectStoreNames.contains(BLOBS_STORE)
        ? request.transaction!.objectStore(BLOBS_STORE)
        : database.createObjectStore(BLOBS_STORE, { keyPath: "id" });
      if (!blobs.indexNames.contains("vaultId")) {
        blobs.createIndex("vaultId", "vaultId");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      databasePromise = null;
      reject(request.error);
    };
    request.onblocked = () => {
      databasePromise = null;
      reject(new Error("The local cache database is blocked."));
    };
  });
  return databasePromise;
}

function blobId(vaultId: string, sha: string) {
  return `${vaultId}:${sha}`;
}

export async function getVaultCache(vaultId: string) {
  const database = await openDatabase();
  const transaction = database.transaction(SNAPSHOTS_STORE, "readonly");
  const done = transactionDone(transaction);
  const result = await requestResult(
    transaction
      .objectStore(SNAPSHOTS_STORE)
      .get(vaultId) as IDBRequest<VaultCacheSnapshot | undefined>,
  );
  await done;
  return result ?? null;
}

export async function getVaultBlobs(vaultId: string, shas: string[]) {
  if (!shas.length) return new Map<string, string>();
  const database = await openDatabase();
  const transaction = database.transaction(BLOBS_STORE, "readonly");
  const done = transactionDone(transaction);
  const store = transaction.objectStore(BLOBS_STORE);
  const uniqueShas = [...new Set(shas)];
  const requests = uniqueShas.map(async (sha) => {
    const blob = await requestResult(
      store.get(blobId(vaultId, sha)) as IDBRequest<CachedBlob | undefined>,
    );
    return blob ? ([sha, blob.content] as const) : null;
  });
  const entries = await Promise.all(requests);
  await done;
  return new Map(entries.filter((entry) => entry !== null));
}

export async function putVaultBlob(
  vaultId: string,
  sha: string,
  content: string,
) {
  const database = await openDatabase();
  const transaction = database.transaction(BLOBS_STORE, "readwrite");
  const done = transactionDone(transaction);
  transaction.objectStore(BLOBS_STORE).put({
    id: blobId(vaultId, sha),
    vaultId,
    sha,
    content,
    updatedAt: new Date().toISOString(),
  } satisfies CachedBlob);
  await done;
}

export async function updateVaultCache(
  snapshot: VaultCacheSnapshot,
  blobs: Map<string, string>,
  staleShas: Iterable<string>,
) {
  const database = await openDatabase();
  const transaction = database.transaction(
    [SNAPSHOTS_STORE, BLOBS_STORE],
    "readwrite",
  );
  const done = transactionDone(transaction);
  transaction.objectStore(SNAPSHOTS_STORE).put(snapshot);
  const store = transaction.objectStore(BLOBS_STORE);
  const updatedAt = new Date().toISOString();
  for (const [sha, content] of blobs) {
    store.put({
      id: blobId(snapshot.id, sha),
      vaultId: snapshot.id,
      sha,
      content,
      updatedAt,
    } satisfies CachedBlob);
  }
  for (const sha of staleShas) store.delete(blobId(snapshot.id, sha));
  const currentShas = new Set(snapshot.vaultFiles.map((file) => file.sha));
  const cursorRequest = store.index("vaultId").openCursor(snapshot.id);
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (!cursor) return;
    const blob = cursor.value as CachedBlob;
    if (!currentShas.has(blob.sha)) cursor.delete();
    cursor.continue();
  };
  await done;
}
