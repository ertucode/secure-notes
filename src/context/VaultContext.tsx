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
  decryptAttachment,
  decryptNote,
  deriveVaultKey,
  encryptAttachment,
  encryptNote,
  parseVaultConfig,
  verifyVaultKey,
  type VaultConfig,
} from "~/lib/crypto";
import { GitHubClient, parseRepository } from "~/lib/github";
import type { EncryptedNotePayload, Note } from "~/lib/notes.schemas";

const TOKEN_KEY = "ciphernote.githubToken";
const REPOSITORY_KEY = "ciphernote.repository";
const CONFIG_PATH = ".ciphernote.json";
const NOTE_DOWNLOAD_CONCURRENCY = 6;

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
  fileShas: Map<string, string>;
  attachmentCache: Map<string, string>;
};
type SaveInput = {
  id: string;
  title: string;
  content: string;
  attachments?: Record<string, string>;
  tags: string[];
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
  loading: boolean;
  loadProgress: { completed: number; total: number };
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
  loadNoteAttachments: (id: string) => Promise<Record<string, string>>;
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

function attachmentPath(id: string) {
  const safeId = id.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 180);
  return `attachments/${safeId || crypto.randomUUID()}.cattach`;
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
  const {
    version,
    content,
    attachments,
    attachmentFiles,
    tags,
    color,
    pinned,
    createdAt,
    updatedAt,
  } = note;
  return {
    version,
    content,
    ...(attachmentFiles ? { attachmentFiles } : { attachments }),
    tags,
    color,
    pinned,
    createdAt,
    updatedAt,
  };
}

export function VaultProvider({ children }: { children: ReactNode }) {
  const sessionRef = useRef<Session | null>(null);
  const notesRef = useRef<Note[]>([]);
  const pendingCreatesRef = useRef(new Map<string, Promise<Note>>());
  const loadGenerationRef = useRef(0);
  const loadingRef = useRef(false);
  const [status, setStatus] = useState<VaultContextValue["status"]>("locked");
  const [notes, setNotes] = useState<Note[]>([]);
  const [folders, setFolders] = useState<string[][]>([]);
  const [error, setError] = useState("");
  const [repository, setRepository] = useState("");
  const [savedToken, setSavedToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState({ completed: 0, total: 0 });

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  const replaceNotes = useCallback(
    (next: Note[] | ((notes: Note[]) => Note[])) => {
      const value = typeof next === "function" ? next(notesRef.current) : next;
      notesRef.current = value;
      setNotes(value);
    },
    [],
  );

  useEffect(() => {
    const stored = readStoredCredentials();
    setRepository(stored.repository);
    setSavedToken(stored.token);
  }, []);

  const loadNotes = useCallback(
    async (session: Session, background = false) => {
      const generation = ++loadGenerationRef.current;
      loadingRef.current = true;
      setLoading(true);
      setLoadProgress({ completed: 0, total: 0 });
      let vaultFiles: Awaited<ReturnType<GitHubClient["listVaultFiles"]>>;
      try {
        vaultFiles = await session.client.listVaultFiles(session.branch);
      } catch (caught) {
        if (loadGenerationRef.current === generation) {
          loadingRef.current = false;
          setLoading(false);
        }
        throw caught;
      }
      const files = vaultFiles.filter((file) => file.path.endsWith(".cnote"));
      session.fileShas = new Map(vaultFiles.map((file) => [file.path, file.sha]));
      const placeholders = files.map(
        (file): Note => ({
          version: 1,
          content: "",
          tags: [],
          pinned: false,
          createdAt: "",
          updatedAt: "",
          id: pathToId(file.path),
          path: file.path,
          sha: file.sha,
          title: titleFromPath(file.path),
          folder: folderFromPath(file.path),
          loaded: false,
        }),
      );
      replaceNotes(placeholders);
      setFolders(
        foldersFromPaths(
          vaultFiles
            .filter((file) => file.path.startsWith("notes/"))
            .map((file) => file.path),
        ),
      );
      setLoadProgress({ completed: 0, total: files.length });

      const completion = (async () => {
        let nextIndex = 0;
        const worker = async () => {
          while (nextIndex < files.length) {
            const file = files[nextIndex++];
            const id = pathToId(file.path);
            try {
              const payload = await decryptNote(
                session.key,
                await session.client.getBlob(file.sha),
              );
              if (
                loadGenerationRef.current !== generation ||
                sessionRef.current !== session
              )
                return;
              const loaded: Note = {
                ...payload,
                id,
                path: file.path,
                sha: file.sha,
                title: titleFromPath(file.path),
                folder: folderFromPath(file.path),
                loaded: true,
              };
              replaceNotes((items) =>
                items.map((item) => (item.id === id ? loaded : item)),
              );
            } catch (e) {
              console.error(e);
              if (
                loadGenerationRef.current !== generation ||
                sessionRef.current !== session
              )
                return;
              replaceNotes((items) =>
                items.map((item) =>
                  item.id === id
                    ? {
                        ...item,
                        loadError:
                          "This file may be damaged or use another vault.",
                      }
                    : item,
                ),
              );
            } finally {
              if (
                loadGenerationRef.current === generation &&
                sessionRef.current === session
              ) {
                setLoadProgress((progress) => ({
                  ...progress,
                  completed: progress.completed + 1,
                }));
              }
            }
          }
        };
        await Promise.all(
          Array.from(
            { length: Math.min(NOTE_DOWNLOAD_CONCURRENCY, files.length) },
            () => worker(),
          ),
        );
        if (
          loadGenerationRef.current === generation &&
          sessionRef.current === session
        ) {
          loadingRef.current = false;
          setLoading(false);
        }
      })();

      if (background) {
        void completion.catch((caught) => {
          console.error(caught);
          if (loadGenerationRef.current === generation) {
            loadingRef.current = false;
            setLoading(false);
            setError("Some notes could not be loaded.");
          }
        });
      } else {
        await completion;
      }
    },
    [replaceNotes],
  );

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
        const session: Session = {
          client,
          branch,
          key,
          config,
          fileShas: new Map(),
          attachmentCache: new Map(),
        };
        sessionRef.current = session;
        await loadNotes(session, true);
        storeCredentials(input.token.trim(), normalizedRepository);
        setSavedToken(input.token.trim());
        setRepository(normalizedRepository);
        setStatus("unlocked");
      } catch (caught) {
        sessionRef.current = null;
        loadGenerationRef.current += 1;
        loadingRef.current = false;
        setLoading(false);
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
    loadGenerationRef.current += 1;
    loadingRef.current = false;
    pendingCreatesRef.current.clear();
    replaceNotes([]);
    setFolders([]);
    setError("");
    setLoading(false);
    setLoadProgress({ completed: 0, total: 0 });
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

  const requireReadySession = () => {
    const session = requireSession();
    if (loadingRef.current)
      throw new Error("Wait for your notes to finish loading.");
    return session;
  };

  const refresh = useCallback(async () => {
    const session = requireSession();
    await Promise.allSettled(pendingCreatesRef.current.values());
    await loadNotes(session);
  }, [loadNotes]);

  const createNote = useCallback(
    (folder: string[] = []): CreateNoteResult => {
      const session = requireReadySession();
      const now = new Date().toISOString();
      const safeFolder = folder.map(safeTitle).filter(Boolean);
      const baseTitle = `Untitled note ${new Date().toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`;
      let title = baseTitle;
      let suffix = 2;
      while (
        notesRef.current.some(
          (note) => note.path === notePath(title, safeFolder),
        )
      ) {
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
    },
    [replaceNotes],
  );

  const createFolder = useCallback(
    async (folder: string[]) => {
      const session = requireReadySession();
      const safeFolder = folder.map(safeTitle).filter(Boolean);
      if (!safeFolder.length) throw new Error("Enter a folder name.");
      const key = folderKey(safeFolder);
      if (folders.some((item) => folderKey(item) === key)) {
        throw new Error("That folder already exists.");
      }
      setFolders((current) =>
        foldersFromPaths([
          ...current.map((item) => `notes/${folderKey(item)}/.gitkeep`),
          `notes/${key}/.gitkeep`,
        ]),
      );
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
    },
    [folders, loadNotes],
  );

  const moveNote = useCallback(
    async (id: string, folder: string[]) => {
      const session = requireReadySession();
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
      if (
        notesRef.current.some(
          (note) => note.id !== id && note.path === nextPath,
        )
      ) {
        throw new Error("A note with that name already exists in this folder.");
      }
      const optimistic = {
        ...current,
        id: pathToId(nextPath),
        path: nextPath,
        folder: safeFolder,
      };
      replaceNotes((items) =>
        items.map((note) => (note.id === id ? optimistic : note)),
      );
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
        replaceNotes((items) =>
          items.map((note) => (note.id === optimistic.id ? moved : note)),
        );
        return moved;
      } catch (caught) {
        await loadNotes(session);
        throw caught;
      }
    },
    [loadNotes, replaceNotes],
  );

  const moveFolder = useCallback(
    async (folder: string[], parent: string[]) => {
      const session = requireReadySession();
      if (!folder.length) throw new Error("The vault root cannot be moved.");
      if (isFolderWithin(parent, folder))
        throw new Error("A folder cannot be moved inside itself.");
      const nextFolder = [...parent, folder.at(-1)!];
      if (folderKey(nextFolder) === folderKey(folder)) return;
      if (folders.some((item) => folderKey(item) === folderKey(nextFolder))) {
        throw new Error("A folder with that name already exists there.");
      }

      const sourcePrefix = `notes/${folderKey(folder)}/`;
      const destinationPrefix = `notes/${folderKey(nextFolder)}/`;
      replaceNotes((items) =>
        items.map((note) => {
          if (!isFolderWithin(note.folder, folder)) return note;
          const nextNoteFolder = [
            ...nextFolder,
            ...note.folder.slice(folder.length),
          ];
          const path = notePath(note.title, nextNoteFolder);
          return { ...note, id: pathToId(path), path, folder: nextNoteFolder };
        }),
      );
      setFolders((items) =>
        foldersFromPaths(
          items.map((item) => {
            const next = isFolderWithin(item, folder)
              ? [...nextFolder, ...item.slice(folder.length)]
              : item;
            return `notes/${folderKey(next)}/.gitkeep`;
          }),
        ),
      );

      try {
        await Promise.allSettled(pendingCreatesRef.current.values());
        const allFiles = await session.client.listVaultFiles(session.branch);
        const files = allFiles.filter((file) =>
          file.path.startsWith(sourcePrefix),
        );
        const sourcePaths = new Set(files.map((file) => file.path));
        for (const file of files) {
          const destination =
            destinationPrefix + file.path.slice(sourcePrefix.length);
          if (
            allFiles.some(
              (candidate) =>
                candidate.path === destination && !sourcePaths.has(destination),
            )
          ) {
            throw new Error(
              "The destination already contains an item with the same name.",
            );
          }
        }
        for (const file of files) {
          const destination =
            destinationPrefix + file.path.slice(sourcePrefix.length);
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
    },
    [folders, loadNotes, replaceNotes],
  );

  const saveNote = useCallback(
    async (input: SaveInput) => {
      const session = requireReadySession();
      const current = notesRef.current.find((note) => note.id === input.id);
      if (!current) throw new Error("Note not found.");
      const nextPath = notePath(input.title, input.folder);
      if (
        notesRef.current.some(
          (note) => note.id !== input.id && note.path === nextPath,
        )
      ) {
        throw new Error("A note with that name already exists in this folder.");
      }
      // Serialize a new note's first save behind its background creation so
      // attachment commits and the note update do not race on the branch.
      let persistedCurrent = current;
      try {
        persistedCurrent =
          (await pendingCreatesRef.current.get(input.id)) ?? current;
      } catch {
        // If creation failed, this save retries it as a new file.
      }
      const referencedIds = new Set(
        [...input.content.matchAll(/attachment:([^\s)]+)/g)].map(
          (match) => match[1],
        ),
      );
      const attachmentSources = Object.fromEntries(
        Object.entries(input.attachments ?? {}).filter(([id]) =>
          referencedIds.has(id),
        ),
      );
      const attachmentFiles: Record<string, string> = {};
      for (const [id, source] of Object.entries(attachmentSources)) {
        const path = current.attachmentFiles?.[id] ?? attachmentPath(id);
        attachmentFiles[id] = path;
        if (session.attachmentCache.get(path) === source) continue;
        const sha = await session.client.putTextFile(
          path,
          await encryptAttachment(session.key, source),
          session.branch,
          `Update attachment for ${input.title}`,
          session.fileShas.get(path),
        );
        session.fileShas.set(path, sha);
        session.attachmentCache.set(path, source);
      }
      const payload: EncryptedNotePayload = {
        ...payloadFromNote(current),
        content: input.content,
        attachments: undefined,
        attachmentFiles:
          Object.keys(attachmentFiles).length > 0 ? attachmentFiles : undefined,
        tags: input.tags,
        updatedAt: new Date().toISOString(),
      };
      const optimistic: Note = {
        ...payload,
        attachments: attachmentSources,
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
        session.fileShas.set(nextPath, sha);
        if (nextPath !== current.path) session.fileShas.delete(current.path);
        replaceNotes((items) =>
          items.map((note) => (note.id === current.id ? updated : note)),
        );
        const retainedAttachmentPaths = new Set(Object.values(attachmentFiles));
        for (const path of Object.values(current.attachmentFiles ?? {})) {
          if (retainedAttachmentPaths.has(path)) continue;
          const attachmentSha = session.fileShas.get(path);
          if (!attachmentSha) continue;
          try {
            await session.client.deleteFile(
              path,
              attachmentSha,
              session.branch,
              `Remove attachment from ${input.title}`,
            );
            session.fileShas.delete(path);
            session.attachmentCache.delete(path);
          } catch (caught) {
            // The note is already saved and no longer references this file.
            console.error(caught);
          }
        }
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
      const session = requireReadySession();
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
      for (const path of Object.values(note.attachmentFiles ?? {})) {
        const sha = session.fileShas.get(path);
        if (!sha) continue;
        try {
          await session.client.deleteFile(
            path,
            sha,
            session.branch,
            `Delete attachment for ${note.title}`,
          );
          session.fileShas.delete(path);
          session.attachmentCache.delete(path);
        } catch (caught) {
          console.error(caught);
        }
      }
      replaceNotes((items) => items.filter((item) => item.id !== id));
    },
    [replaceNotes],
  );

  const deleteFolder = useCallback(
    async (folder: string[]) => {
      const session = requireReadySession();
      await Promise.allSettled(pendingCreatesRef.current.values());
      const prefix = `notes/${folderKey(folder)}/`;
      const removedNotes = notesRef.current.filter((note) =>
        note.path.startsWith(prefix),
      );
      const files = (
        await session.client.listVaultFiles(session.branch)
      ).filter((file) => file.path.startsWith(prefix));
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
      for (const note of removedNotes) {
        for (const path of Object.values(note.attachmentFiles ?? {})) {
          const sha = session.fileShas.get(path);
          if (!sha) continue;
          try {
            await session.client.deleteFile(
              path,
              sha,
              session.branch,
              `Delete attachment for ${note.title}`,
            );
            session.fileShas.delete(path);
            session.attachmentCache.delete(path);
          } catch (caught) {
            console.error(caught);
          }
        }
      }
      replaceNotes((items) =>
        items.filter((note) => !note.path.startsWith(prefix)),
      );
      const key = folderKey(folder);
      setFolders((items) =>
        items.filter((item) => {
          const itemKey = folderKey(item);
          return itemKey !== key && !itemKey.startsWith(`${key}/`);
        }),
      );
    },
    [loadNotes, replaceNotes],
  );

  const togglePin = useCallback(
    async (id: string) => {
      const session = requireReadySession();
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

  const loadNoteAttachments = useCallback(
    async (id: string) => {
      const session = requireReadySession();
      const note = notesRef.current.find((item) => item.id === id);
      if (!note || !note.loaded) throw new Error("The note is not loaded yet.");
      const result = { ...(note.attachments ?? {}) };
      const entries = Object.entries(note.attachmentFiles ?? {});
      let nextIndex = 0;
      const worker = async () => {
        while (nextIndex < entries.length) {
          const [attachmentId, path] = entries[nextIndex++];
          if (
            !path.startsWith("attachments/") ||
            !path.endsWith(".cattach")
          ) {
            throw new Error("The note contains an invalid attachment path.");
          }
          let source = session.attachmentCache.get(path);
          if (!source) {
            const sha = session.fileShas.get(path);
            if (!sha) throw new Error(`Attachment ${attachmentId} is missing.`);
            source = await decryptAttachment(
              session.key,
              await session.client.getBlob(sha),
            );
            session.attachmentCache.set(path, source);
          }
          result[attachmentId] = source;
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(4, entries.length) }, () => worker()),
      );
      replaceNotes((items) =>
        items.map((item) =>
          item.id === id ? { ...item, attachments: result } : item,
        ),
      );
      return result;
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
      loading,
      loadProgress,
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
      loadNoteAttachments,
    }),
    [
      status,
      notes,
      folders,
      repository,
      savedToken,
      error,
      loading,
      loadProgress,
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
      loadNoteAttachments,
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
