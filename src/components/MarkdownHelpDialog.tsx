import { Command, X } from "lucide-react";
import { useEffect, useRef } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
};

const formatting = [
  ["Bold", "**text**", "B"],
  ["Italic", "*text*", "I"],
  ["Strikethrough", "~~text~~", "⌥X"],
  ["Inline code", "`code`", "E"],
  ["Inline math", "$x^2$", ""],
];

const blocks = [
  ["Heading", "# Heading"],
  ["Bulleted list", "- Item"],
  ["Numbered list", "1. Item"],
  ["Task", "- [ ] Task"],
  ["Quote", "> Quote"],
  ["Code block", "```js"],
  ["Divider", "---"],
  ["Image", "Right-click → Add image"],
  ["Math block", "$$ or \\["],
];

export function MarkdownHelpDialog({ open, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-black/65 p-4 backdrop-blur-[2px]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="max-h-[min(720px,90vh)] w-full max-w-2xl overflow-y-auto rounded-xl border border-[var(--background-modifier-border)] bg-[var(--background-primary)] p-5 shadow-2xl min-[560px]:p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="markdown-guide-title"
      >
        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="m-0 text-[10px] font-bold tracking-[0.12em] text-[var(--text-accent)] uppercase">
              Editor help
            </p>
            <h2 id="markdown-guide-title" className="mt-1 mb-0 text-xl font-semibold">
              Markdown guide
            </h2>
            <p className="mt-1.5 mb-0 text-xs text-[var(--text-muted)]">
              Type the syntax shown below, or select text and use a shortcut.
            </p>
          </div>
          <button
            ref={closeRef}
            className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-lg border-0 bg-transparent text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)]"
            type="button"
            aria-label="Close Markdown guide"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>

        <div className="mt-6 grid gap-6 min-[560px]:grid-cols-2">
          <section aria-labelledby="text-formatting-title">
            <h3 id="text-formatting-title" className="m-0 text-xs font-semibold text-[var(--text-muted)]">
              Text formatting
            </h3>
            <div className="mt-2 overflow-hidden rounded-lg border border-[var(--background-modifier-border)]">
              {formatting.map(([label, syntax, shortcut]) => (
                <div
                  className="flex min-h-11 items-center justify-between gap-3 border-b border-[var(--background-modifier-border)] px-3 last:border-b-0"
                  key={label}
                >
                  <span className="text-xs text-[var(--text-normal)]">{label}</span>
                  <div className="flex items-center gap-2">
                    <code className="rounded bg-[var(--background-primary-alt)] px-2 py-1 text-[11px] text-[var(--text-accent)]">
                      {syntax}
                    </code>
                    {shortcut && (
                      <kbd className="inline-flex min-w-11 items-center justify-center gap-0.5 rounded border border-[var(--background-modifier-border)] bg-[var(--background-primary-alt)] px-1.5 py-1 text-[10px] text-[var(--text-muted)]">
                        <Command size={10} />{shortcut}
                      </kbd>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section aria-labelledby="blocks-title">
            <h3 id="blocks-title" className="m-0 text-xs font-semibold text-[var(--text-muted)]">
              Blocks and media
            </h3>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {blocks.map(([label, syntax]) => (
                <div
                  className="rounded-lg border border-[var(--background-modifier-border)] bg-[var(--background-primary-alt)] p-2.5"
                  key={label}
                >
                  <div className="text-[10px] text-[var(--text-muted)]">{label}</div>
                  <code className="mt-1 block overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-[var(--text-accent)]">
                    {syntax}
                  </code>
                </div>
              ))}
            </div>
            <div className="mt-2 flex min-h-11 items-center justify-between gap-3 rounded-lg border border-[var(--background-modifier-border)] bg-[var(--background-primary-alt)] px-3">
              <span className="text-xs text-[var(--text-normal)]">
                Exit code block
              </span>
              <kbd className="inline-flex items-center justify-center gap-0.5 rounded border border-[var(--background-modifier-border)] px-2 py-1 text-[10px] text-[var(--text-muted)]">
                <Command size={10} /> Enter
              </kbd>
            </div>
            <div className="mt-2 flex min-h-11 items-center justify-between gap-3 rounded-lg border border-[var(--background-modifier-border)] bg-[var(--background-primary-alt)] px-3">
              <span className="text-xs text-[var(--text-normal)]">
                Collapse / expand code block
              </span>
              <kbd className="inline-flex shrink-0 items-center justify-center gap-0.5 rounded border border-[var(--background-modifier-border)] px-2 py-1 text-[10px] text-[var(--text-muted)]">
                <Command size={10} /> Shift Enter
              </kbd>
            </div>
          </section>
        </div>

        <p className="mt-5 mb-0 rounded-lg bg-[var(--background-primary-alt)] px-3 py-2.5 text-[11px] leading-relaxed text-[var(--text-muted)]">
          Start block syntax at the beginning of an empty line. For headings,
          lists, tasks, quotes, and code blocks, type the shown prefix followed
          by <strong>Space</strong>. On Windows and Linux, use <strong>Ctrl</strong>
          instead of <strong>Command</strong> for shortcuts.
        </p>
        <p className="mt-3 mb-0 text-[11px] leading-relaxed text-[var(--text-muted)]">
          Math: paste a formula between <code>\[</code> and <code>\]</code> or
          {" "}<code>$$</code> delimiters. To start a new math block, type
          {" "}<code>$$</code> then <strong>Space</strong>. Edit the LaTeX in the
          block directly; the preview updates as you type. Use <strong>Hide LaTeX</strong>
          {" "}to show only the formula and <strong>Edit LaTeX</strong> to edit it again.
        </p>
      </section>
    </div>
  );
}
