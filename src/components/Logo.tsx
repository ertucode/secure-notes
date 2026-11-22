import { ShieldCheck } from "lucide-react";
import type { MouseEventHandler } from "react";

type Props = {
  centered?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
};

export function Logo({ centered = false, onClick }: Props) {
  const className = `flex items-center gap-2.5 font-serif text-[21px] font-semibold tracking-[-0.3px] ${centered ? "justify-center pb-[31px]" : "px-2.5 min-[721px]:pb-[31px]"}`;
  const content = (
    <>
      <span className="grid size-[31px] place-items-center rounded-[9px] bg-vault-500 text-[var(--text-on-accent)]">
        <ShieldCheck size={19} strokeWidth={2.4} />
      </span>
      <span>Ciphernote</span>
    </>
  );

  if (onClick) {
    return (
      <button
        className={`${className} cursor-pointer border-0 bg-transparent text-[var(--text-normal)] hover:text-[var(--text-accent)] focus-visible:rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--interactive-accent)]`}
        type="button"
        aria-label="Open Markdown guide"
        aria-haspopup="dialog"
        title="Markdown guide"
        onClick={onClick}
      >
        {content}
      </button>
    );
  }

  return (
    <div className={className} aria-label="Ciphernote">
      {content}
    </div>
  );
}
