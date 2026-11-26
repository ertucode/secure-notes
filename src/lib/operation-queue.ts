export type OperationQueue = {
  run: <T>(operation: () => Promise<T>) => Promise<T>;
  drain: () => Promise<void>;
  getPendingCount: () => number;
  subscribe: (callback: (pending: number) => void) => () => void;
  destroy: () => void;
};

export function createOperationQueue(): OperationQueue {
  let tail: Promise<unknown> = Promise.resolve();
  let pending = 0;
  let destroyed = false;
  const subscribers = new Set<(pending: number) => void>();

  function notify() {
    if (destroyed) return;
    for (const callback of subscribers) {
      callback(pending);
    }
  }

  function run<T>(operation: () => Promise<T>): Promise<T> {
    pending += 1;
    notify();
    const result = tail.then(
      () => operation(),
      () => operation(),
    );
    tail = result.catch(() => {});
    result.then(
      () => {
        pending -= 1;
        notify();
      },
      () => {
        pending -= 1;
        notify();
      },
    );
    return result;
  }

  async function drain(): Promise<void> {
    await tail;
  }

  function getPendingCount(): number {
    return pending;
  }

  function subscribe(callback: (pending: number) => void): () => void {
    subscribers.add(callback);
    callback(pending);
    return () => {
      subscribers.delete(callback);
    };
  }

  function destroy(): void {
    destroyed = true;
    subscribers.clear();
  }

  return { run, drain, getPendingCount, subscribe, destroy };
}
