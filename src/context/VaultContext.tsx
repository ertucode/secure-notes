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

type VaultContextValue = {
  status: "locked" | "unlocking" | "unlocked";
  notes: Note[];
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
  createNote: (folder?: string[]) => Promise<Note>;
  saveNote: (input: SaveInput) => Promise<Note>;
  deleteNote: (id: string) => Promise<void>;
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

function payloadFromNote(note: Note): EncryptedNotePayload {
  const { version, content, attachments, tags, color, pinned, createdAt, updatedAt } = note;
  return { version, content, attachments, tags, color, pinned, createdAt, updatedAt };
}

export function VaultProvider({ children }: { children: ReactNode }) {
  const sessionRef = useRef<Session | null>(null);
  const [status, setStatus] = useState<VaultContextValue["status"]>("locked");
  const [notes, setNotes] = useState<Note[]>([]);
  const [error, setError] = useState("");
  const [repository, setRepository] = useState("");
  const [savedToken, setSavedToken] = useState("");

  useEffect(() => {
    const stored = readStoredCredentials();
    setRepository(stored.repository);
    setSavedToken(stored.token);
  }, []);

  const loadNotes = useCallback(async (session: Session) => {
    const files = await session.client.listNoteFiles(session.branch);
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
    setNotes(loaded);
  }, []);

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
        setNotes([]);
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
    setNotes([]);
    setError("");
    setStatus("locked");
  }, []);

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
    async () => loadNotes(requireSession()),
    [loadNotes],
  );

  const createNote = useCallback(async (folder: string[] = []) => {
    const session = requireSession();
    const now = new Date().toISOString();
    const safeFolder = folder.map(safeTitle).filter(Boolean);
    const baseTitle = `Untitled note ${new Date().toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`;
    let title = baseTitle;
    let suffix = 2;
    while (notes.some((note) => note.path === notePath(title, safeFolder))) {
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
    const sha = await session.client.putTextFile(
      path,
      await encryptNote(session.key, payload),
      session.branch,
      `Create ${title}`,
    );
    const note: Note = {
      ...payload,
      id: pathToId(path),
      path,
      sha,
      title,
      folder: safeFolder,
    };
    setNotes((current) => [note, ...current]);
    return note;
  }, [notes]);

  const saveNote = useCallback(
    async (input: SaveInput) => {
      const session = requireSession();
      const current = notes.find((note) => note.id === input.id);
      if (!current) throw new Error("Note not found.");
      const nextPath = notePath(input.title, input.folder);
      const payload: EncryptedNotePayload = {
        ...payloadFromNote(current),
        content: input.content,
        attachments: input.attachments,
        tags: input.tags,
        color: input.color,
        updatedAt: new Date().toISOString(),
      };
      const encrypted = await encryptNote(session.key, payload);
      let sha: string;
      if (nextPath === current.path) {
        sha = await session.client.putTextFile(
          nextPath,
          encrypted,
          session.branch,
          `Update ${input.title}`,
          current.sha,
        );
      } else {
        sha = await session.client.putTextFile(
          nextPath,
          encrypted,
          session.branch,
          `Rename ${current.title} to ${input.title}`,
        );
        await session.client.deleteFile(
          current.path,
          current.sha,
          session.branch,
          `Remove old file for ${current.title}`,
        );
      }
      const updated: Note = {
        ...payload,
        id: pathToId(nextPath),
        path: nextPath,
        sha,
        title: safeTitle(input.title),
        folder: input.folder,
      };
      setNotes((items) =>
        items.map((note) => (note.id === input.id ? updated : note)),
      );
      return updated;
    },
    [notes],
  );

  const deleteNote = useCallback(
    async (id: string) => {
      const session = requireSession();
      const note = notes.find((item) => item.id === id);
      if (!note) throw new Error("Note not found.");
      await session.client.deleteFile(
        note.path,
        note.sha,
        session.branch,
        `Delete ${note.title}`,
      );
      setNotes((items) => items.filter((item) => item.id !== id));
    },
    [notes],
  );

  const togglePin = useCallback(
    async (id: string) => {
      const session = requireSession();
      const note = notes.find((item) => item.id === id);
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
      setNotes((items) =>
        items.map((item) =>
          item.id === id ? { ...note, ...payload, sha } : item,
        ),
      );
    },
    [notes],
  );

  const value = useMemo<VaultContextValue>(
    () => ({
      status,
      notes,
      repository,
      savedToken,
      error,
      unlock,
      lock,
      disconnect,
      refresh,
      createNote,
      saveNote,
      deleteNote,
      togglePin,
    }),
    [
      status,
      notes,
      repository,
      savedToken,
      error,
      unlock,
      lock,
      disconnect,
      refresh,
      createNote,
      saveNote,
      deleteNote,
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
