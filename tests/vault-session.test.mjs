import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { clearVaultSession, readVaultSession, storeVaultSession } from "../src/lib/vault-session.ts";

const dom = new JSDOM("", { url: "https://notes.example" });
globalThis.sessionStorage = dom.window.sessionStorage;

test("session password survives reads and is scoped to its repository", () => {
  storeVaultSession("repo-a", "password-a");
  assert.equal(readVaultSession("repo-a"), "password-a");
  assert.equal(readVaultSession("repo-b"), null);
  assert.equal(dom.window.localStorage.length, 0);
});

test("password changes replace the session password and locking clears it", () => {
  storeVaultSession("repo-a", "password-b");
  assert.equal(readVaultSession("repo-a"), "password-b");
  clearVaultSession();
  assert.equal(readVaultSession("repo-a"), null);
});

test("malformed and unavailable session storage do not block unlocking", () => {
  sessionStorage.setItem("ciphernote.vaultSession", "{");
  assert.equal(readVaultSession("repo-a"), null);
  const storage = globalThis.sessionStorage;
  globalThis.sessionStorage = {
    getItem() { throw new Error("disabled"); },
    setItem() { throw new Error("disabled"); },
    removeItem() { throw new Error("disabled"); },
  };
  try {
    assert.equal(readVaultSession("repo-a"), null);
    assert.doesNotThrow(() => storeVaultSession("repo-a", "password"));
    assert.doesNotThrow(clearVaultSession);
  } finally {
    globalThis.sessionStorage = storage;
  }
});
