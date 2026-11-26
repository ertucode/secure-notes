import assert from "node:assert/strict";
import test from "node:test";
import { createOperationQueue } from "../src/lib/operation-queue.ts";

test("operations run sequentially in the order they are enqueued", async () => {
  const queue = createOperationQueue();
  const results = [];

  const first = queue.run(async () => {
    results.push("first-start");
    await Promise.resolve();
    results.push("first-end");
    return 1;
  });

  const second = queue.run(async () => {
    results.push("second-start");
    await Promise.resolve();
    results.push("second-end");
    return 2;
  });

  await Promise.all([first, second]);

  assert.deepEqual(results, [
    "first-start",
    "first-end",
    "second-start",
    "second-end",
  ]);
  assert.equal(await first, 1);
  assert.equal(await second, 2);
});

test("a failing operation does not block subsequent operations", async () => {
  const queue = createOperationQueue();
  const results = [];

  const first = queue.run(async () => {
    results.push("first");
    throw new Error("boom");
  });

  const second = queue.run(async () => {
    results.push("second");
    return "ok";
  });

  await assert.rejects(first, /boom/);
  assert.equal(await second, "ok");
  assert.deepEqual(results, ["first", "second"]);
});

test("drain waits for all queued operations to finish", async () => {
  const queue = createOperationQueue();
  let completed = false;

  queue.run(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    completed = true;
  });

  assert.equal(completed, false);
  await queue.drain();
  assert.equal(completed, true);
});

test("getPendingCount reflects running operations", async () => {
  const queue = createOperationQueue();
  let resolveOperation;
  const operation = new Promise((resolve) => {
    resolveOperation = resolve;
  });

  assert.equal(queue.getPendingCount(), 0);
  const promise = queue.run(async () => {
    await operation;
    return "done";
  });
  assert.equal(queue.getPendingCount(), 1);
  resolveOperation();
  await promise;
  assert.equal(queue.getPendingCount(), 0);
});

test("subscribe receives current and future pending counts", async () => {
  const queue = createOperationQueue();
  const counts = [];
  const unsubscribe = queue.subscribe((pending) => {
    counts.push(pending);
  });

  assert.deepEqual(counts, [0]);

  let resolveOperation;
  const operation = new Promise((resolve) => {
    resolveOperation = resolve;
  });

  const promise = queue.run(async () => {
    await operation;
  });

  assert.deepEqual(counts, [0, 1]);
  resolveOperation();
  await promise;
  assert.deepEqual(counts, [0, 1, 0]);

  unsubscribe();
});

test("unsubscribe stops future notifications", async () => {
  const queue = createOperationQueue();
  const counts = [];
  const unsubscribe = queue.subscribe((pending) => {
    counts.push(pending);
  });
  unsubscribe();

  await queue.run(async () => {});
  assert.deepEqual(counts, [0]);
});
