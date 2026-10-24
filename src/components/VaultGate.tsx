import { GitFork, KeyRound, LockKeyhole, ShieldCheck } from "lucide-react";
import {
  useEffect,
  useState,
  type FormEvent,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { useVault } from "~/context/VaultContext";
import { Logo } from "./Logo";
import { PrimaryButton } from "./ui";

function UnlockField({
  label,
  icon,
  help,
  ...inputProps
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  icon: ReactNode;
  help?: string;
}) {
  return (
    <label>
      <span className="mb-[7px] block text-[10px] font-semibold text-[var(--text-muted)]">
        {label}
      </span>
      <div className="flex h-11 items-center gap-[9px] rounded-md border border-[var(--background-modifier-border)] bg-[var(--background-modifier-form-field)] px-3 text-[var(--text-faint)] transition duration-150 focus-within:border-[var(--interactive-accent)] focus-within:shadow-[0_0_0_2px_#7f6df240]">
        {icon}
        <input
          className="min-w-0 flex-1 border-0 bg-transparent text-xs text-[var(--text-normal)] outline-0 placeholder:text-[var(--text-faint)]"
          {...inputProps}
        />
      </div>
      {help && (
        <small className="mt-1.5 block text-[8px] leading-[1.45] text-[var(--text-faint)]">
          {help}
        </small>
      )}
    </label>
  );
}

export function VaultGate({ children }: { children: ReactNode }) {
  const vault = useVault();
  const [token, setToken] = useState("");
  const [repository, setRepository] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    setToken(vault.savedToken);
    setRepository(vault.repository);
  }, [vault.savedToken, vault.repository]);

  useEffect(() => {
    if (!token.trim() || !repository.trim()) return;
    void vault.prepareUnlock({ token, repository }).catch(() => {
      // Unlock displays connection and credential errors when the user submits.
    });
  }, [repository, token, vault.prepareUnlock]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const enteredPassword = password;
    setPassword("");
    try {
      await vault.unlock({ token, repository, password: enteredPassword });
    } catch {
      /* rendered by context */
    }
  }

  if (vault.status === "unlocked") return children;
  return (
    <main className="grid min-h-screen min-w-80 place-items-center bg-[radial-gradient(circle_at_50%_0%,#2d2850_0,#202020_40%,#161616_100%)] px-5 py-10 font-sans text-[var(--text-normal)] [color-scheme:dark]">
      <div className="w-[min(470px,100%)] rounded-xl border border-[var(--background-modifier-border)] bg-[var(--background-primary)] px-[42px] pt-[38px] pb-[34px] shadow-[0_24px_70px_#00000066] max-[520px]:px-[22px] max-[520px]:pt-[31px] max-[520px]:pb-[27px]">
        <Logo centered />
        <div className="mx-auto mb-[22px] grid size-12 place-items-center rounded-xl bg-vault-500 text-[var(--text-on-accent)]">
          <LockKeyhole size={24} />
        </div>
        <p className="m-0 mb-[9px] text-center text-[10px] font-bold tracking-[0.13em] text-[var(--text-accent)] uppercase">
          Encrypted GitHub vault
        </p>
        <h1 className="m-0 text-center font-serif text-[39px] leading-none font-semibold tracking-[-1.3px]">
          Unlock your notes
        </h1>
        <p className="mx-auto mt-3 mb-[29px] w-[310px] max-w-full text-center text-xs leading-[1.55] text-[var(--text-muted)]">
          Connect a repository and decrypt your notes locally in this browser.
        </p>
        <form onSubmit={submit} className="grid gap-4" autoComplete="off">
          <UnlockField
            label="Repository URL"
            icon={<GitFork size={17} />}
            type="url"
            required
            value={repository}
            onChange={(event) => setRepository(event.target.value)}
            placeholder="https://github.com/you/notes"
            autoComplete="url"
          />
          <UnlockField
            label="Fine-grained access token"
            icon={<ShieldCheck size={17} />}
            help="Stored in this browser’s local storage. Grant repository Contents access only."
            type="password"
            required
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="github_pat_…"
            autoComplete="off"
          />
          <UnlockField
            autoFocus
            label="Vault password"
            icon={<KeyRound size={17} />}
            help="Used to derive a non-extractable key, then immediately discarded."
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Never stored — not even locally"
            autoComplete="off"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
          />
          {vault.error && (
            <p
              className="-mt-0.5 mb-0 rounded-md border border-[#5c292c] bg-[#3d2526] px-[11px] py-[9px] text-[10px] leading-[1.45] text-[var(--text-error)]"
              role="alert"
            >
              {vault.error}
            </p>
          )}
          <PrimaryButton
            className="mt-1 w-full"
            disabled={vault.status === "unlocking"}
          >
            {vault.status === "unlocking"
              ? "Unlocking and decrypting…"
              : "Unlock vault"}
          </PrimaryButton>
        </form>
        <div className="mt-[22px] flex items-start gap-2 border-t border-[var(--background-modifier-border)] pt-[18px] text-[9px] leading-[1.55] text-[var(--text-faint)] [&_svg]:mt-px [&_svg]:shrink-0 [&_svg]:text-[var(--text-accent)]">
          <LockKeyhole size={14} />
          <span>
            Files are encrypted and decrypted on this device. The key and
            plaintext are never sent to GitHub or the application server.
          </span>
        </div>
      </div>
    </main>
  );
}
