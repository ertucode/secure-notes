import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement, useRef } from "react";
import { createRoot } from "react-dom/client";
import { useNoteScroll } from "../src/lib/use-note-scroll.ts";

const dom = new JSDOM("<div id='root'></div>", {
  url: "https://notes.example", pretendToBeVisual: true,
});
for (const key of ["window", "document", "sessionStorage"]) globalThis[key] = dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let resize;
globalThis.ResizeObserver = class {
  constructor(callback) { resize = callback; }
  observe() {}
  disconnect() {}
};
let maxScroll = 1000;
window.scrollTo = ({ top }) => { window.scrollY = Math.min(top, maxScroll); };
const key = (id) => `ciphernote.noteScroll:repo:${id}`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function Note({ id }) {
  const ref = useRef(null);
  useNoteScroll("repo", id, ref);
  return createElement("div", { ref });
}

test("restores after content loads, throttles writes, and flushes when leaving", async () => {
  sessionStorage.setItem(key("a"), "600");
  maxScroll = 100;
  const root = createRoot(document.getElementById("root"));
  await act(async () => root.render(createElement(Note, { id: "a" })));
  await wait(40);
  assert.equal(window.scrollY, 100);
  assert.equal(sessionStorage.getItem(key("a")), "600");
  maxScroll = 1000;
  resize();
  await wait(40);
  assert.equal(window.scrollY, 600);
  window.scrollY = 720;
  window.dispatchEvent(new window.Event("scroll"));
  window.scrollY = 740;
  window.dispatchEvent(new window.Event("scroll"));
  assert.equal(sessionStorage.getItem(key("a")), "600");
  await wait(230);
  assert.equal(sessionStorage.getItem(key("a")), "740");
  window.scrollY = 800;
  window.dispatchEvent(new window.Event("scroll"));
  await act(async () => root.render(createElement(Note, { id: "b" })));
  assert.equal(sessionStorage.getItem(key("a")), "800");
  await wait(40);
  assert.equal(window.scrollY, 0);
  await act(async () => root.unmount());
});
