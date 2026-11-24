import assert from "node:assert/strict";
import test from "node:test";
import { indexedDB } from "fake-indexeddb";
import { JSDOM } from "jsdom";
import * as drafts from "../src/lib/note-drafts.ts";

globalThis.indexedDB = indexedDB;
globalThis.sessionStorage = new JSDOM("", { url: "https://notes.example" }).window.sessionStorage;

const draft = {
  title: "Private title",
  content: "Unsaved ![image](attachment:image-1)",
  attachments: { "image-1": `data:image/png;base64,${"A".repeat(6 * 1024 * 1024)}` },
  tags: "personal, draft",
};

test("large image drafts survive a module reload without putting content in session storage", async () => {
  await drafts.writeNoteDraft("repo", "note", draft);
  assert.ok(sessionStorage.getItem("ciphernote.draftSession").length < 300);
  assert.ok(!JSON.stringify(sessionStorage).includes(draft.title));
  const reloaded = await import("../src/lib/note-drafts.ts?refresh");
  assert.deepEqual(await reloaded.readNoteDraft("repo", "note"), draft);
  assert.equal(await reloaded.readNoteDraft("other-repo", "note"), null);
  assert.equal(await reloaded.readNoteDraft("repo", "other-note"), null);
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open("ciphernote-drafts", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const stored = await new Promise((resolve) => {
    const request = database.transaction("drafts").objectStore("drafts").getAll();
    request.onsuccess = () => resolve(request.result);
  });
  assert.equal(stored.length, 1);
  assert.ok(stored[0].ciphertext instanceof ArrayBuffer);
  assert.ok(!new TextDecoder().decode(stored[0].ciphertext).includes(draft.title));
  database.close();
});

test("queued edits preserve order and removal cannot be undone by a pending write", async () => {
  const first = drafts.writeNoteDraft("repo", "ordered", { ...draft, attachments: {} });
  const next = drafts.writeNoteDraft("repo", "ordered", { ...draft, title: "Latest", attachments: {} });
  await Promise.all([first, next]);
  assert.equal((await drafts.readNoteDraft("repo", "ordered")).title, "Latest");
  const write = drafts.writeNoteDraft("repo", "ordered", { ...draft, attachments: {} });
  const remove = drafts.removeNoteDraft("repo", "ordered");
  await Promise.all([write, remove]);
  assert.equal(await drafts.readNoteDraft("repo", "ordered"), null);
});

test("locking discards the session key and cancels queued writes", async () => {
  await drafts.writeNoteDraft("repo", "locked", { ...draft, attachments: {} });
  const queued = drafts.writeNoteDraft("repo", "locked", { ...draft, attachments: {} });
  drafts.clearNoteDraftSession();
  await queued;
  assert.equal(sessionStorage.getItem("ciphernote.draftSession"), null);
  const newTab = await import("../src/lib/note-drafts.ts?new-tab");
  assert.equal(await newTab.readNoteDraft("repo", "locked"), null);
});

test("switching between notes retains independent unsaved text, titles, tags and images", async () => {
  const a = { ...draft, attachments: { image: "data:image/png;base64,AAAA" } };
  const b = { title: "Second", content: "Other edits", tags: "other", attachments: {} };
  await drafts.writeNoteDraft("repo", "a", a);
  await drafts.writeNoteDraft("repo", "b", b);
  assert.deepEqual(await drafts.readNoteDraft("repo", "a"), a);
  assert.deepEqual(await drafts.readNoteDraft("repo", "b"), b);
  assert.deepEqual((await drafts.listNoteDraftIds("repo")).sort(), ["a", "b"]);
});

test("change comparison clears after reverting edits and ignores unreferenced attachments", () => {
  const original = { title: "Note", content: "Original text\n", tags: "one, two", attachments: {} };
  assert.ok(!drafts.sameNoteDraft(original, { ...original, content: "Original text!\n" }));
  assert.ok(drafts.sameNoteDraft(original, { ...original, content: "Original text\n" }));
  assert.ok(drafts.sameNoteDraft(original, { ...original, content: "Original text", attachments: { unused: "image" } }));
  assert.ok(drafts.sameNoteDraft(original, { ...original, tags: "one,two," }));
  assert.ok(!drafts.sameNoteDraft(original, { ...original, title: "Renamed" }));
  assert.ok(!drafts.sameNoteDraft(original, { ...original, tags: "one, three" }));
  const image = { ...original, content: "![image](attachment:a)", attachments: { a: "original" } };
  assert.ok(!drafts.sameNoteDraft(image, { ...image, attachments: { a: "compressed" } }));
  assert.ok(drafts.sameNoteDraft(image, { ...image, content: "![image](attachment:b)", attachments: { b: "original" } }));
});

test("unavailable browser storage still preserves drafts across note switching in memory", async () => {
  const storage = globalThis.sessionStorage;
  globalThis.sessionStorage = {
    getItem() { throw new Error("disabled"); },
    setItem() { throw new Error("disabled"); },
  };
  try {
    const isolated = await import("../src/lib/note-drafts.ts?disabled-storage");
    const small = { ...draft, attachments: {} };
    await assert.rejects(isolated.writeNoteDraft("repo", "note", small), /disabled/);
    assert.deepEqual(await isolated.readNoteDraft("repo", "note"), small);
  } finally {
    globalThis.sessionStorage = storage;
  }
});
