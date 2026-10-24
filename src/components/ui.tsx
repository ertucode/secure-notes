import type { ButtonHTMLAttributes, ReactNode } from 'react'

export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ')
}

const primaryButtonClasses = 'inline-flex min-h-[42px] items-center justify-center gap-2 rounded-md border-0 bg-vault-500 px-[18px] text-xs font-semibold text-[var(--text-on-accent)] transition duration-150 hover:bg-vault-700 disabled:cursor-wait disabled:opacity-65'

export function PrimaryButton({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={cn(primaryButtonClasses, className)} {...props} />
}

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean
  bordered?: boolean
  danger?: boolean
}

export function IconButton({ active, bordered, danger, className, ...props }: IconButtonProps) {
  return (
    <button
      className={cn(
        'inline-grid size-[29px] cursor-pointer place-items-center rounded-md border-0 bg-transparent p-0 text-[var(--text-muted)] transition duration-150 hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)] disabled:cursor-wait disabled:opacity-55',
        active && 'bg-[var(--background-modifier-active-hover)] text-[var(--text-accent)]',
        bordered && 'border border-[var(--background-modifier-border)] bg-[var(--background-primary-alt)]',
        danger && 'hover:border-[var(--text-error)] hover:bg-[#3d2526] hover:text-[var(--text-error)]',
        className,
      )}
      {...props}
    />
  )
}

export function MessagePage({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--background-primary)] p-20 font-sans text-[var(--text-normal)] max-[520px]:p-8">
      <h1 className="m-0 font-serif text-[40px] font-semibold leading-none tracking-[-1.3px]">{title}</h1>
      <p className="text-[var(--text-muted)]">{children}</p>
      {action}
    </div>
  )
}

export const backLinkClasses = 'inline-flex items-center gap-2 text-[11px] font-medium text-[var(--text-muted)] no-underline hover:text-[var(--text-accent)]'
