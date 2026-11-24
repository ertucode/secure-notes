const PASSWORD_KEY = "ciphernote.vaultSession";

export function readVaultSession(repository: string): string | null {
  try {
    const stored = JSON.parse(sessionStorage.getItem(PASSWORD_KEY) ?? "null");
    return stored?.repository === repository && typeof stored.password === "string"
      ? stored.password
      : null;
  } catch {
    return null;
  }
}

export function storeVaultSession(repository: string, password: string) {
  try {
    sessionStorage.setItem(PASSWORD_KEY, JSON.stringify({ repository, password }));
  } catch {
    // Unlocking still works when browser storage is unavailable.
  }
}

export function clearVaultSession() {
  try {
    sessionStorage.removeItem(PASSWORD_KEY);
  } catch {
    // Browser storage may be disabled.
  }
}
