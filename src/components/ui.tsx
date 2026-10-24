import type { ButtonHTMLAttributes, ReactNode } from 'react'

export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ')
}

const primaryButtonClasses = 'inline-flex min-h-[42px] items-center justify-center gap-2 rounded-[9px] border-0 bg-vault-500 px-[18px] text-xs font-semibold text-white shadow-[0_5px_14px_#3e604928] transition duration-200 hover:-translate-y-px hover:bg-vault-700 disabled:cursor-wait disabled:opacity-65'

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
        'inline-grid size-[29px] cursor-pointer place-items-center rounded-[7px] border-0 bg-transparent p-0 text-[#858a81] transition duration-200 hover:bg-[#e9eee7] hover:text-[#41604c] disabled:cursor-wait disabled:opacity-55',
        active && 'bg-[#e9eee7] text-[#41604c]',
        bordered && 'border border-[#dfe2d9] bg-white',
        danger && 'hover:border-[#e0b7b2] hover:bg-[#fff5f4] hover:text-[#994c46]',
        className,
      )}
      {...props}
    />
  )
}

export function MessagePage({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="p-20 font-sans text-[#252821] max-[520px]:p-8">
      <h1 className="m-0 font-serif text-[40px] font-medium leading-none tracking-[-1.3px]">{title}</h1>
      <p className="text-[#73776e]">{children}</p>
      {action}
    </div>
  )
}

export const backLinkClasses = 'inline-flex items-center gap-2 text-[11px] font-medium text-[#6d7269] no-underline hover:text-[#304e3b]'
