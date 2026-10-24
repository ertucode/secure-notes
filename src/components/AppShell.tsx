import { useRouter } from "@tanstack/react-router";
import { FolderPlus, KeyRound, Menu, Plus, Search, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { useVault } from "~/context/VaultContext";
import { Logo } from "./Logo";
import { ChangePasswordDialog } from "./ChangePasswordDialog";
import { NoteTree, type NoteNavigationItem } from "./NoteTree";

type Props = { children: ReactNode };

function SidebarAction(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className="flex min-h-[38px] w-9 cursor-pointer items-center justify-center gap-[9px] rounded-md border-0 bg-transparent p-0 text-left text-[0] font-medium text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)] disabled:cursor-wait disabled:opacity-55 min-[721px]:w-auto min-[721px]:justify-start min-[721px]:px-[11px] min-[721px]:text-xs [&_svg]:text-[var(--text-muted)]"
      {...props}
    />
  );
}

export function AppShell({ children }: Props) {
  const vault = useVault();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closePasswordDialog = useCallback(
    () => setPasswordDialogOpen(false),
    [],
  );

  useEffect(() => {
    if (!explorerOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExplorerOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [explorerOpen]);

  async function createNote(folder: string[] = []) {
    setCreating(true);
    try {
      const { note, persisted } = vault.createNote(folder);
      void persisted.catch((caught) => {
        window.alert(
          caught instanceof Error
            ? caught.message
            : "Could not create the note. Your draft is still open; saving will retry.",
        );
      });
      sessionStorage.setItem("ciphernote.focusNewNoteTitle", note.id);
      await router.navigate({
        to: "/notes/$noteId",
        params: { noteId: note.id },
      });
      setExplorerOpen(false);
    } catch (caught) {
      window.alert(
        caught instanceof Error ? caught.message : "Could not create the note.",
      );
    } finally {
      setCreating(false);
    }
  }

  async function createFolder(parent: string[] = []) {
    const name = window.prompt("Folder name (use / for nested folders)");
    if (!name) return;
    const folder = [
      ...parent,
      ...name
        .split("/")
        .map((part) => part.trim())
        .filter(Boolean),
    ];
    if (folder.length === parent.length) return;
    setCreating(true);
    try {
      await vault.createFolder(folder);
    } catch (caught) {
      window.alert(
        caught instanceof Error
          ? caught.message
          : "Could not create the folder.",
      );
    } finally {
      setCreating(false);
    }
  }

  async function deleteFolder(folder: string[]) {
    const name = folder.join("/");
    if (
      !window.confirm(`Delete “${name}” and every note inside it permanently?`)
    )
      return;
    const activeId =
      router.state.location.pathname.match(/^\/notes\/([^/]+)$/)?.[1];
    const activeNote = vault.notes.find((note) => note.id === activeId);
    const deletingActiveNote =
      activeNote?.folder
        .slice(0, folder.length)
        .every((part, index) => part === folder[index]) ?? false;
    try {
      await vault.deleteFolder(folder);
      if (deletingActiveNote) await router.navigate({ to: "/" });
    } catch (caught) {
      window.alert(
        caught instanceof Error
          ? caught.message
          : "Could not delete the folder.",
      );
    }
  }

  async function deleteNote(note: NoteNavigationItem) {
    if (!window.confirm(`Delete “${note.title}” from GitHub permanently?`))
      return;
    try {
      await vault.deleteNote(note.id);
      if (router.state.location.pathname === `/notes/${note.id}`)
        await router.navigate({ to: "/" });
    } catch (caught) {
      window.alert(
        caught instanceof Error ? caught.message : "Could not delete the note.",
      );
    }
  }

  async function moveNote(id: string, folder: string[]) {
    const isActive = router.state.location.pathname === `/notes/${id}`;
    try {
      const moved = await vault.moveNote(id, folder);
      if (isActive && moved.id !== id) {
        await router.navigate({
          to: "/notes/$noteId",
          params: { noteId: moved.id },
          replace: true,
        });
      }
    } catch (caught) {
      window.alert(
        caught instanceof Error ? caught.message : "Could not move the note.",
      );
    }
  }

  async function moveFolder(folder: string[], parent: string[]) {
    const activeId =
      router.state.location.pathname.match(/^\/notes\/([^/]+)$/)?.[1];
    const activeNote = vault.notes.find((note) => note.id === activeId);
    const movingActiveNote =
      activeNote?.folder
        .slice(0, folder.length)
        .every((part, index) => part === folder[index]) ?? false;
    try {
      await vault.moveFolder(folder, parent);
      if (movingActiveNote) await router.navigate({ to: "/" });
    } catch (caught) {
      window.alert(
        caught instanceof Error ? caught.message : "Could not move the folder.",
      );
    }
  }

  async function openSearch() {
    setExplorerOpen(false);
    await router.navigate({ to: "/" });
    window.setTimeout(
      () =>
        document.querySelector<HTMLInputElement>("[data-note-search]")?.focus(),
      220,
    );
  }

  return (
    <div className="min-h-screen min-w-80 bg-vault-50 font-sans text-[var(--text-normal)] [color-scheme:dark] min-[721px]:grid min-[721px]:grid-cols-[300px_1fr]">
      <header className="sticky top-0 z-30 grid h-14 grid-cols-[44px_1fr_44px] items-center border-b border-[var(--background-modifier-border)] bg-vault-100/95 px-2.5 backdrop-blur-xl min-[721px]:hidden">
        <button
          ref={menuButtonRef}
          className="grid size-11 cursor-pointer place-items-center rounded-xl border-0 bg-transparent text-[var(--text-muted)] active:bg-[var(--background-modifier-hover)]"
          onClick={() => setExplorerOpen(true)}
          aria-label="Open notes explorer"
          aria-expanded={explorerOpen}
          aria-controls="notes-explorer"
        >
          <Menu size={21} />
        </button>
        <div className="justify-self-center [&>div]:p-0 [&>div>span:last-child]:text-[18px] [&>div>span:first-child]:size-7 [&>div>span:first-child>svg]:size-4">
          <Logo />
        </div>
        <button
          className="grid size-11 cursor-pointer place-items-center rounded-xl border-0 bg-transparent text-[var(--text-accent)] active:bg-[var(--background-modifier-hover)] disabled:opacity-50"
          disabled={creating || vault.loading}
          onClick={() => void createNote()}
          aria-label="Create note"
        >
          <Plus size={23} />
        </button>
      </header>

      <button
        className={`fixed inset-0 z-40 border-0 bg-black/60 p-0 backdrop-blur-[2px] transition-opacity duration-200 min-[721px]:hidden ${explorerOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`}
        onClick={() => {
          setExplorerOpen(false);
          menuButtonRef.current?.focus();
        }}
        aria-label="Close notes explorer"
        tabIndex={explorerOpen ? 0 : -1}
      />

      <aside
        id="notes-explorer"
        className={`fixed inset-y-0 left-0 z-50 flex w-[min(88vw,340px)] flex-col border-r border-[var(--background-modifier-border)] bg-vault-100 px-4 pt-[max(14px,env(safe-area-inset-top))] pb-[max(16px,env(safe-area-inset-bottom))] shadow-2xl transition-[transform,visibility] duration-200 ease-out ${explorerOpen ? "visible translate-x-0" : "invisible -translate-x-full"} min-[721px]:visible min-[721px]:z-10 min-[721px]:w-[300px] min-[721px]:translate-x-0 min-[721px]:px-5 min-[721px]:pt-8 min-[721px]:pb-5 min-[721px]:shadow-none`}
        aria-label="Notes explorer"
      >
        <div className="mb-3 flex h-11 items-center justify-between min-[721px]:hidden">
          <div>
            <p className="m-0 text-sm font-semibold text-[var(--text-normal)]">
              Notes
            </p>
            <p className="m-0 mt-0.5 text-[10px] text-[var(--text-faint)]">
              {vault.notes.length} {vault.notes.length === 1 ? "note" : "notes"}
            </p>
          </div>
          <button
            className="grid size-10 cursor-pointer place-items-center rounded-xl border-0 bg-transparent text-[var(--text-muted)] active:bg-[var(--background-modifier-hover)]"
            onClick={() => {
              setExplorerOpen(false);
              menuButtonRef.current?.focus();
            }}
            aria-label="Close notes explorer"
          >
            <X size={20} />
          </button>
        </div>
        <div className="hidden min-[721px]:block">
          <Logo />
        </div>
        <nav
          className="mb-3 grid grid-cols-[1fr_auto] gap-2 min-[721px]:mb-5 min-[721px]:grid-cols-1 min-[721px]:gap-1"
          aria-label="Vault actions"
        >
          <button
            className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border border-[var(--background-modifier-border)] bg-[var(--background-primary-alt)] px-3 text-xs font-medium text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)] min-[721px]:hidden"
            onClick={() => void openSearch()}
          >
            <Search size={17} />
            Search notes
          </button>
          <button
            className="grid size-11 cursor-pointer place-items-center rounded-lg border border-[var(--background-modifier-border)] bg-[var(--background-primary-alt)] text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)] min-[721px]:hidden"
            disabled={creating || vault.loading}
            onClick={() => void createFolder()}
            aria-label="Create folder"
          >
            <FolderPlus size={18} />
          </button>
          <div className="hidden min-[721px]:contents">
            <SidebarAction
              disabled={creating || vault.loading}
              onClick={() => void createNote()}
            >
              <Plus size={16} />
              New Note
            </SidebarAction>
            <SidebarAction
              disabled={creating || vault.loading}
              onClick={() => void createFolder()}
            >
              <FolderPlus size={16} />
              New Folder
            </SidebarAction>
            <SidebarAction onClick={() => void openSearch()}>
              <Search size={16} />
              Search
            </SidebarAction>
          </div>
        </nav>
        <div className="mb-2 flex items-center justify-between px-2 min-[721px]:hidden">
          <span className="text-[10px] font-bold tracking-[0.12em] text-[var(--text-faint)] uppercase">
            Explorer
          </span>
          <button
            className="cursor-pointer rounded-md border-0 bg-transparent px-2 py-1 text-[10px] font-semibold text-[var(--text-accent)]"
            disabled={creating || vault.loading}
            onClick={() => void createNote()}
          >
            + Note
          </button>
        </div>
        <NoteTree
          notes={
            vault.notes.map(({ id, title, folder }) => ({
              id,
              title,
              folder,
            })) satisfies NoteNavigationItem[]
          }
          folders={vault.folders}
          onCreateNote={(folder) => void createNote(folder)}
          onCreateFolder={(folder) => void createFolder(folder)}
          onDeleteFolder={(folder) => void deleteFolder(folder)}
          onDeleteNote={(note) => void deleteNote(note)}
          onMoveNote={(id, folder) => void moveNote(id, folder)}
          onMoveFolder={(folder, parent) => void moveFolder(folder, parent)}
          onNavigate={() => setExplorerOpen(false)}
        />
        <button
          className="mt-3 flex min-h-10 w-full cursor-pointer items-center gap-2.5 rounded-lg border border-[var(--background-modifier-border)] bg-[var(--background-primary-alt)] px-3 text-xs font-medium text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)] disabled:cursor-wait disabled:opacity-55"
          disabled={vault.loading || vault.changingPassword}
          onClick={() => {
            setExplorerOpen(false);
            setPasswordDialogOpen(true);
          }}
        >
          <KeyRound size={16} />
          Change password
        </button>
      </aside>
      <main className="min-w-0 min-[721px]:col-start-2">{children}</main>
      <ChangePasswordDialog
        open={passwordDialogOpen}
        onClose={closePasswordDialog}
      />
    </div>
  );
}
