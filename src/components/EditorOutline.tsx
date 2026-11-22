import { useEffect, useState, type RefObject } from "react";

type Heading = {
  element: HTMLHeadingElement;
  text: string;
  level: number;
};

export function EditorOutline({
  editorRef,
}: {
  editorRef: RefObject<HTMLDivElement | null>;
}) {
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [active, setActive] = useState<HTMLHeadingElement | null>(null);

  useEffect(() => {
    const root = editorRef.current;
    if (!root) return;
    let entries: Heading[] = [];
    let frame = 0;

    function updateActive() {
      let current = entries[0]?.element ?? null;
      for (const { element } of entries) {
        if (element.getBoundingClientRect().top > 120) break;
        current = element;
      }
      setActive(current);
    }

    function refresh() {
      entries = Array.from(
        root!.querySelectorAll<HTMLHeadingElement>(
          ".ProseMirror h1, .ProseMirror h2, .ProseMirror h3, .ProseMirror h4, .ProseMirror h5, .ProseMirror h6",
        ),
        (element) => ({
          element,
          text: element.textContent?.trim() || "Untitled heading",
          level: Number(element.tagName.slice(1)),
        }),
      );
      setHeadings(entries);
      updateActive();
    }

    function scheduleActiveUpdate() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updateActive);
    }

    const observer = new MutationObserver(refresh);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    refresh();
    window.addEventListener("scroll", scheduleActiveUpdate, true);
    window.addEventListener("resize", scheduleActiveUpdate);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", scheduleActiveUpdate, true);
      window.removeEventListener("resize", scheduleActiveUpdate);
    };
  }, [editorRef]);

  return (
    <nav className="editor-outline" aria-label="Note outline">
      <div className="editor-outline-title">On this page</div>
      {headings.length ? (
        <ol className="editor-outline-list">
          {headings.map(({ element, text, level }, index) => (
            <li key={index}>
              <button
                type="button"
                className="editor-outline-heading"
                aria-current={active === element ? "location" : undefined}
                aria-label={`Heading level ${level}: ${text}`}
                style={{ paddingLeft: 16 + (level - 1) * 12 }}
                title={text}
                onClick={() => {
                  element.scrollIntoView({
                    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
                      ? "instant"
                      : "smooth",
                    block: "start",
                  });
                }}
              >
                <span className="editor-outline-level" aria-hidden="true">H{level}</span>
                <span className="truncate">{text}</span>
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-xs text-[var(--text-faint)]">Headings will appear here.</p>
      )}
    </nav>
  );
}
