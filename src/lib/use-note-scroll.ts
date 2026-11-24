import { useEffect, type RefObject } from "react";

export function useNoteScroll(
  repository: string,
  noteId: string,
  container: RefObject<HTMLDivElement | null>,
) {
  useEffect(() => {
    const key = `ciphernote.noteScroll:${repository}:${noteId}`;
    let target = 0;
    try {
      const stored = Number(sessionStorage.getItem(key));
      if (Number.isFinite(stored) && stored > 0) target = stored;
    } catch {
      // Scroll restoration is optional when storage is disabled.
    }

    let restoring = true;
    let offset = target;
    let writeTimer: number | undefined;
    let frame = 0;
    const write = () => {
      window.clearTimeout(writeTimer);
      writeTimer = undefined;
      try {
        sessionStorage.setItem(key, String(offset));
      } catch {
        // Storage may be disabled or full.
      }
    };
    const observer = new ResizeObserver(() => {
      if (restoring) scheduleRestore();
    });
    const stopRestoring = () => {
      restoring = false;
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
    const restore = () => {
      if (!restoring) return;
      window.scrollTo({ top: target, behavior: "instant" });
      if (Math.abs(window.scrollY - target) < 1) stopRestoring();
    };
    function scheduleRestore() {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(restore);
    }
    if (container.current) observer.observe(container.current);
    scheduleRestore();
    const restoreTimeout = window.setTimeout(stopRestoring, 5000);

    const onScroll = () => {
      if (restoring) return;
      offset = window.scrollY;
      if (writeTimer === undefined) writeTimer = window.setTimeout(write, 200);
    };
    const onInteraction = () => {
      if (!restoring) return;
      stopRestoring();
      offset = window.scrollY;
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") write();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("wheel", onInteraction, { passive: true });
    window.addEventListener("touchstart", onInteraction, { passive: true });
    window.addEventListener("pointerdown", onInteraction);
    window.addEventListener("keydown", onInteraction);
    window.addEventListener("pagehide", write);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stopRestoring();
      window.clearTimeout(restoreTimeout);
      write();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("wheel", onInteraction);
      window.removeEventListener("touchstart", onInteraction);
      window.removeEventListener("pointerdown", onInteraction);
      window.removeEventListener("keydown", onInteraction);
      window.removeEventListener("pagehide", write);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [repository, noteId, container]);
}
