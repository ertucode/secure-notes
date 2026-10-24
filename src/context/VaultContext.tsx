import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  createVaultConfig,
  decryptNote,
  deriveVaultKey,
  encryptNote,
  parseVaultConfig,
  verifyVaultKey,
  type VaultConfig,
} from "~/lib/crypto";
import { GitHubClient, parseRepository } from "~/lib/github";
import type {
  EncryptedNotePayload,
  Note,
  NoteColor,
} from "~/lib/notes.schemas";

const TOKEN_KEY = "ciphernote.githubToken";
const REPOSITORY_KEY = "ciphernote.repository";
const CONFIG_PATH = ".ciphernote.json";

const readStoredCredentials = () => ({
  repository: localStorage.getItem(REPOSITORY_KEY) ?? "",
  token: localStorage.getItem(TOKEN_KEY) ?? "",
});
const storeCredentials = (token: string, repository: string) => {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(REPOSITORY_KEY, repository);
};
const clearCredentials = () => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REPOSITORY_KEY);
};

type Session = {
  client: GitHubClient;
  branch: string;
  key: CryptoKey;
  config: VaultConfig;
};
type SaveInput = {
  id: string;
  title: string;
  content: string;
  attachments?: Record<string, string>;
  tags: string[];
  color: NoteColor;
  folder: string[];
};
type CreateNoteResult = {
  note: Note;
  persisted: Promise<Note>;
};

type VaultContextValue = {
  status: "locked" | "unlocking" | "unlocked";
  notes: Note[];
  folders: string[][];
  repository: string;
  savedToken: string;
  error: string;
  unlock: (input: {
    token: string;
    repository: string;
    password: string;
  }) => Promise<void>;
  lock: () => void;
  disconnect: () => void;
  refresh: () => Promise<void>;
  createNote: (folder?: string[]) => CreateNoteResult;
  createFolder: (folder: string[]) => Promise<void>;
  moveNote: (id: string, folder: string[]) => Promise<Note>;
  moveFolder: (folder: string[], parent: string[]) => Promise<void>;
  saveNote: (input: SaveInput) => Promise<Note>;
  deleteNote: (id: string) => Promise<void>;
  deleteFolder: (folder: string[]) => Promise<void>;
  togglePin: (id: string) => Promise<void>;
};

const VaultContext = createContext<VaultContextValue | null>(null);

function pathToId(path: string) {
  const bytes = new TextEncoder().encode(path);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function titleFromPath(path: string) {
  return path
    .split("/")
    .at(-1)!
    .replace(/\.cnote$/, "");
}

function folderFromPath(path: string) {
  return path.split("/").slice(1, -1);
}

function safeTitle(value: string) {
  return (
    value
      .trim()
      .replace(/[\\/\u0000-\u001f]/g, "-")
      .replace(/\.+$/, "")
      .slice(0, 120) || "Untitled note"
  );
}

function notePath(title: string, folder: string[]) {
  const safeFolder = folder.map(safeTitle).filter(Boolean);
  return ["notes", ...safeFolder, `${safeTitle(title)}.cnote`].join("/");
}

function folderKey(folder: string[]) {
  return folder.join("/");
}

function isFolderWithin(folder: string[], parent: string[]) {
  return parent.every((part, index) => folder[index] === part);
}

function foldersFromPaths(paths: string[]) {
  const folders = new Map<string, string[]>();
  for (const path of paths) {
    const parts = path.split("/").slice(1, -1);
    for (let index = 1; index <= parts.length; index += 1) {
      const folder = parts.slice(0, index);
      folders.set(folderKey(folder), folder);
    }
  }
  return [...folders.values()];
}

function payloadFromNote(note: Note): EncryptedNotePayload {
  const { version, content, attachments, tags, color, pinned, createdAt, updatedAt } = note;
  return { version, content, attachments, tags, color, pinned, createdAt, updatedAt };
}

export function VaultProvider({ children }: { children: ReactNode }) {
  const sessionRef = useRef<Session | null>(null);
  const notesRef = useRef<Note[]>([]);
  const pendingCreatesRef = useRef(new Map<string, Promise<Note>>());
  const [status, setStatus] = useState<VaultContextValue["status"]>("locked");
  const [notes, setNotes] = useState<Note[]>([]);
  const [folders, setFolders] = useState<string[][]>([]);
  const [error, setError] = useState("");
  const [repository, setRepository] = useState("");
  const [savedToken, setSavedToken] = useState("");

  const replaceNotes = useCallback((next: Note[] | ((notes: Note[]) => Note[])) => {
    const value = typeof next === "function" ? next(notesRef.current) : next;
    notesRef.current = value;
    setNotes(value);
  }, []);

  useEffect(() => {
    const stored = readStoredCredentials();
    setRepository(stored.repository);
    setSavedToken(stored.token);
  }, []);

  const loadNotes = useCallback(async (session: Session) => {
    const vaultFiles = await session.client.listVaultFiles(session.branch);
    const files = vaultFiles.filter((file) => file.path.endsWith(".cnote"));
    const loaded = await Promise.all(
      files.map(async (file) => {
        try {
          const payload = await decryptNote(
            session.key,
            await session.client.getBlob(file.sha),
          );
          return {
            ...payload,
            id: pathToId(file.path),
            path: file.path,
            sha: file.sha,
            title: titleFromPath(file.path),
            folder: folderFromPath(file.path),
          } satisfies Note;
        } catch (e) {
          console.error(e);
          throw new Error(
            `Could not decrypt ${file.path}. The file may be damaged or use another vault.`,
          );
        }
      }),
    );
    replaceNotes(loaded);
    setFolders(foldersFromPaths(vaultFiles.map((file) => file.path)));
  }, [replaceNotes]);

  const unlock = useCallback(
    async (input: { token: string; repository: string; password: string }) => {
      setStatus("unlocking");
      setError("");
      try {
        if (!input.token.trim())
          throw new Error("Enter a fine-grained GitHub token.");
        if (input.password.length < 8)
          throw new Error("Use a password with at least 8 characters.");
        const normalizedRepository = `https://github.com/${parseRepository(input.repository).owner}/${parseRepository(input.repository).repo}`;
        const client = new GitHubClient(
          input.token.trim(),
          parseRepository(normalizedRepository),
        );
        const repositoryInfo = await client.getRepository();
        const branch = repositoryInfo.defaultBranch;
        const configFile = repositoryInfo.empty
          ? null
          : await client.getTextFile(CONFIG_PATH, branch);
        let config: VaultConfig;
        let key: CryptoKey;
        if (configFile) {
          config = parseVaultConfig(configFile.content);
          key = await deriveVaultKey(input.password, config);
          if (!(await verifyVaultKey(key, config)))
            throw new Error("Incorrect vault password.");
        } else {
          const existingNotes = repositoryInfo.empty
            ? []
            : await client.listNoteFiles(branch);
          if (existingNotes.length)
            throw new Error(
              "This repository has encrypted notes but no .ciphernote.json configuration.",
            );
          const created = await createVaultConfig(input.password);
          config = created.config;
          key = created.key;
          await client.putTextFile(
            CONFIG_PATH,
            JSON.stringify(config, null, 2),
            repositoryInfo.empty ? undefined : branch,
            "Initialize Ciphernote vault",
          );
        }
        const session = { client, branch, key, config };
        await loadNotes(session);
        sessionRef.current = session;
        storeCredentials(input.token.trim(), normalizedRepository);
        setSavedToken(input.token.trim());
        setRepository(normalizedRepository);
        setStatus("unlocked");
      } catch (caught) {
        sessionRef.current = null;
        replaceNotes([]);
        setFolders([]);
        setStatus("locked");
        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to unlock this vault.",
        );
        throw caught;
      }
    },
    [loadNotes],
  );

  const lock = useCallback(() => {
    sessionRef.current = null;
    pendingCreatesRef.current.clear();
    replaceNotes([]);
    setFolders([]);
    setError("");
    setStatus("locked");
  }, [replaceNotes]);

  const disconnect = useCallback(() => {
    lock();
    clearCredentials();
    setSavedToken("");
    setRepository("");
  }, [lock]);

  const requireSession = () => {
    if (!sessionRef.current) throw new Error("The vault is locked.");
    return sessionRef.current;
  };

  const refresh = useCallback(
    async () => {
      const session = requireSession();
      await Promise.allSettled(pendingCreatesRef.current.values());
      await loadNotes(session);
    },
    [loadNotes],
  );

  const createNote = useCallback((folder: string[] = []): CreateNoteResult => {
    const session = requireSession();
    const now = new Date().toISOString();
    const safeFolder = folder.map(safeTitle).filter(Boolean);
    const baseTitle = `Untitled note ${new Date().toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`;
    let title = baseTitle;
    let suffix = 2;
    while (notesRef.current.some((note) => note.path === notePath(title, safeFolder))) {
      title = `${baseTitle} ${suffix}`;
      suffix += 1;
    }
    const path = notePath(title, safeFolder);
    const payload: EncryptedNotePayload = {
      version: 1,
      content: "",
      attachments: {},
      tags: [],
      color: "mint",
      pinned: false,
      createdAt: now,
      updatedAt: now,
    };
    const note: Note = {
      ...payload,
      id: pathToId(path),
      path,
      sha: "",
      title,
      folder: safeFolder,
    };
    replaceNotes((current) => [note, ...current]);

    const persisted = (async () => {
      const sha = await session.client.putTextFile(
        path,
        await encryptNote(session.key, payload),
        session.branch,
        `Create ${title}`,
      );
      const savedNote = { ...note, sha };
      if (sessionRef.current !== session) return savedNote;
      replaceNotes((current) =>
        current.map((item) =>
          item.id === note.id && !item.sha ? { ...item, sha } : item,
        ),
      );
      return savedNote;
    })();
    pendingCreatesRef.current.set(note.id, persisted);
    void persisted.then(
      () => {
        if (pendingCreatesRef.current.get(note.id) === persisted)
          pendingCreatesRef.current.delete(note.id);
      },
      () => {
        if (pendingCreatesRef.current.get(note.id) === persisted)
          pendingCreatesRef.current.delete(note.id);
      },
    );

    return { note, persisted };
  }, [replaceNotes]);

  const createFolder = useCallback(async (folder: string[]) => {
    const session = requireSession();
    const safeFolder = folder.map(safeTitle).filter(Boolean);
    if (!safeFolder.length) throw new Error("Enter a folder name.");
    const key = folderKey(safeFolder);
    if (folders.some((item) => folderKey(item) === key)) {
      throw new Error("That folder already exists.");
    }
    setFolders((current) => foldersFromPaths([
      ...current.map((item) => `notes/${folderKey(item)}/.gitkeep`),
      `notes/${key}/.gitkeep`,
    ]));
    try {
      await session.client.putTextFile(
        `notes/${key}/.gitkeep`,
        "",
        session.branch,
        `Create folder ${key}`,
      );
    } catch (caught) {
      await loadNotes(session);
      throw caught;
    }
  }, [folders, loadNotes]);

  const moveNote = useCallback(async (id: string, folder: string[]) => {
    const session = requireSession();
    try {
      await pendingCreatesRef.current.get(id);
    } catch {
      // A failed optimistic creation is retried by the copy below.
    }
    const current = notesRef.current.find((note) => note.id === id);
    if (!current) throw new Error("Note not found.");
    const safeFolder = folder.map(safeTitle).filter(Boolean);
    const nextPath = notePath(current.title, safeFolder);
    if (nextPath === current.path) return current;
    if (notesRef.current.some((note) => note.id !== id && note.path === nextPath)) {
      throw new Error("A note with that name already exists in this folder.");
    }
    const optimistic = { ...current, id: pathToId(nextPath), path: nextPath, folder: safeFolder };
    replaceNotes((items) => items.map((note) => note.id === id ? optimistic : note));
    try {
      const sha = await session.client.putTextFile(
        nextPath,
        current.sha
          ? await session.client.getBlob(current.sha)
          : await encryptNote(session.key, payloadFromNote(current)),
        session.branch,
        `Move ${current.title}`,
      );
      await session.client.deleteFile(
        current.path,
        current.sha,
        session.branch,
        `Remove old file for ${current.title}`,
      );
      const moved = { ...optimistic, sha };
      replaceNotes((items) => items.map((note) => note.id === optimistic.id ? moved : note));
      return moved;
    } catch (caught) {
      await loadNotes(session);
      throw caught;
    }
  }, [loadNotes, replaceNotes]);

  const moveFolder = useCallback(async (folder: string[], parent: string[]) => {
    const session = requireSession();
    if (!folder.length) throw new Error("The vault root cannot be moved.");
    if (isFolderWithin(parent, folder)) throw new Error("A folder cannot be moved inside itself.");
    const nextFolder = [...parent, folder.at(-1)!];
    if (folderKey(nextFolder) === folderKey(folder)) return;
    if (folders.some((item) => folderKey(item) === folderKey(nextFolder))) {
      throw new Error("A folder with that name already exists there.");
    }

    const sourcePrefix = `notes/${folderKey(folder)}/`;
    const destinationPrefix = `notes/${folderKey(nextFolder)}/`;
    replaceNotes((items) => items.map((note) => {
      if (!isFolderWithin(note.folder, folder)) return note;
      const nextNoteFolder = [...nextFolder, ...note.folder.slice(folder.length)];
      const path = notePath(note.title, nextNoteFolder);
      return { ...note, id: pathToId(path), path, folder: nextNoteFolder };
    }));
    setFolders((items) => foldersFromPaths(items.map((item) => {
      const next = isFolderWithin(item, folder)
        ? [...nextFolder, ...item.slice(folder.length)]
        : item;
      return `notes/${folderKey(next)}/.gitkeep`;
    })));

    try {
      await Promise.allSettled(pendingCreatesRef.current.values());
      const allFiles = await session.client.listVaultFiles(session.branch);
      const files = allFiles.filter((file) => file.path.startsWith(sourcePrefix));
      const sourcePaths = new Set(files.map((file) => file.path));
      for (const file of files) {
        const destination = destinationPrefix + file.path.slice(sourcePrefix.length);
        if (allFiles.some((candidate) => candidate.path === destination && !sourcePaths.has(destination))) {
          throw new Error("The destination already contains an item with the same name.");
        }
      }
      for (const file of files) {
        const destination = destinationPrefix + file.path.slice(sourcePrefix.length);
        await session.client.putTextFile(
          destination,
          await session.client.getBlob(file.sha),
          session.branch,
          `Move folder ${folderKey(folder)}`,
        );
      }
      for (const file of files) {
        await session.client.deleteFile(
          file.path,
          file.sha,
          session.branch,
          `Remove old folder ${folderKey(folder)}`,
        );
      }
      await loadNotes(session);
    } catch (caught) {
      await loadNotes(session);
      throw caught;
    }
  }, [folders, loadNotes, replaceNotes]);

  const saveNote = useCallback(
    async (input: SaveInput) => {
      const session = requireSession();
      const current = notesRef.current.find((note) => note.id === input.id);
      if (!current) throw new Error("Note not found.");
      const nextPath = notePath(input.title, input.folder);
      if (notesRef.current.some((note) => note.id !== input.id && note.path === nextPath)) {
        throw new Error("A note with that name already exists in this folder.");
      }
      const payload: EncryptedNotePayload = {
        ...payloadFromNote(current),
        content: input.content,
        attachments: input.attachments,
        tags: input.tags,
        color: input.color,
        updatedAt: new Date().toISOString(),
      };
      const optimistic: Note = {
        ...payload,
        // Keep the route identity stable while the rename is in flight.
        id: current.id,
        path: nextPath,
        sha: current.sha,
        title: safeTitle(input.title),
        folder: input.folder,
      };
      replaceNotes((items) =>
        items.map((note) => (note.id === input.id ? optimistic : note)),
      );

      try {
        // Serialize a new note's first save behind its background creation so
        // the remote update receives the SHA, without delaying the local UI.
        let persistedCurrent = current;
        try {
          persistedCurrent = await pendingCreatesRef.current.get(input.id) ?? current;
        } catch {
          // If creation failed, this save retries it as a new file.
        }
        const encrypted = await encryptNote(session.key, payload);
        let sha: string;
        if (nextPath === current.path) {
          sha = await session.client.putTextFile(
            nextPath,
            encrypted,
            session.branch,
            `Update ${input.title}`,
            persistedCurrent.sha || undefined,
          );
        } else {
          sha = await session.client.putTextFile(
            nextPath,
            encrypted,
            session.branch,
            `Rename ${current.title} to ${input.title}`,
          );
          if (persistedCurrent.sha) {
            await session.client.deleteFile(
              current.path,
              persistedCurrent.sha,
              session.branch,
              `Remove old file for ${current.title}`,
            );
          }
        }
        const updated = { ...optimistic, sha };
        updated.id = pathToId(nextPath);
        replaceNotes((items) =>
          items.map((note) => (note.id === current.id ? updated : note)),
        );
        return updated;
      } catch (caught) {
        replaceNotes((items) =>
          items.map((note) => (note.id === current.id ? current : note)),
        );
        throw caught;
      }
    },
    [replaceNotes],
  );

  const deleteNote = useCallback(
    async (id: string) => {
      const session = requireSession();
      try {
        await pendingCreatesRef.current.get(id);
      } catch {
        // A failed optimistic creation has no remote file to delete.
      }
      const note = notesRef.current.find((item) => item.id === id);
      if (!note) throw new Error("Note not found.");
      if (note.sha) {
        await session.client.deleteFile(
          note.path,
          note.sha,
          session.branch,
          `Delete ${note.title}`,
        );
      }
      replaceNotes((items) => items.filter((item) => item.id !== id));
    },
    [replaceNotes],
  );

  const deleteFolder = useCallback(
    async (folder: string[]) => {
      const session = requireSession();
      await Promise.allSettled(pendingCreatesRef.current.values());
      const prefix = `notes/${folderKey(folder)}/`;
      const files = (await session.client.listVaultFiles(session.branch))
        .filter((file) => file.path.startsWith(prefix));
      try {
        for (const file of files) {
          await session.client.deleteFile(
            file.path,
            file.sha,
            session.branch,
            `Delete folder ${folderKey(folder)}`,
          );
        }
      } catch (caught) {
        await loadNotes(session);
        throw caught;
      }
      replaceNotes((items) => items.filter((note) => !note.path.startsWith(prefix)));
      const key = folderKey(folder);
      setFolders((items) => items.filter((item) => {
        const itemKey = folderKey(item);
        return itemKey !== key && !itemKey.startsWith(`${key}/`);
      }));
    },
    [loadNotes, replaceNotes],
  );

  const togglePin = useCallback(
    async (id: string) => {
      const session = requireSession();
      try {
        await pendingCreatesRef.current.get(id);
      } catch {
        // A failed optimistic creation is retried by this write.
      }
      const note = notesRef.current.find((item) => item.id === id);
      if (!note) throw new Error("Note not found.");
      const payload = {
        ...payloadFromNote(note),
        pinned: !note.pinned,
        updatedAt: new Date().toISOString(),
      };
      const sha = await session.client.putTextFile(
        note.path,
        await encryptNote(session.key, payload),
        session.branch,
        `${payload.pinned ? "Pin" : "Unpin"} ${note.title}`,
        note.sha,
      );
      replaceNotes((items) =>
        items.map((item) =>
          item.id === id ? { ...note, ...payload, sha } : item,
        ),
      );
    },
    [replaceNotes],
  );

  const value = useMemo<VaultContextValue>(
    () => ({
      status,
      notes,
      folders,
      repository,
      savedToken,
      error,
      unlock,
      lock,
      disconnect,
      refresh,
      createNote,
      createFolder,
      moveNote,
      moveFolder,
      saveNote,
      deleteNote,
      deleteFolder,
      togglePin,
    }),
    [
      status,
      notes,
      folders,
      repository,
      savedToken,
      error,
      unlock,
      lock,
      disconnect,
      refresh,
      createNote,
      createFolder,
      moveNote,
      moveFolder,
      saveNote,
      deleteNote,
      deleteFolder,
      togglePin,
    ],
  );
  return (
    <VaultContext.Provider value={value}>{children}</VaultContext.Provider>
  );
}

export function useVault() {
  const value = useContext(VaultContext);
  if (!value) throw new Error("useVault must be used inside VaultProvider");
  return value;
}
