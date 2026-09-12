import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

export const fieldClass = [
  'w-full rounded-md border border-line bg-white/60 px-3 text-sm text-ink placeholder:text-ink-faint',
  'transition-[border-color,box-shadow] duration-(--duration-fast)',
  'hover:border-ink-faint focus:border-lime-2 focus:outline-none focus:ring-2 focus:ring-lime/40',
  'aria-invalid:border-danger aria-invalid:focus:ring-danger/30',
  'disabled:cursor-not-allowed disabled:opacity-50',
].join(' ');

export interface InputProps extends ComponentProps<'input'> {
  invalid?: boolean;
}

export function Input({ className, invalid, ...props }: InputProps) {
  return (
    <input
      className={cn(fieldClass, 'h-9', className)}
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
}

export interface TextareaProps extends ComponentProps<'textarea'> {
  invalid?: boolean;
}

export function Textarea({ className, invalid, rows = 3, ...props }: TextareaProps) {
  return (
    <textarea
      rows={rows}
      className={cn(fieldClass, 'py-2 leading-6', className)}
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
}

export interface SelectProps extends ComponentProps<'select'> {
  invalid?: boolean;
}

/** Native select, styled. Native keeps keyboard and screen-reader behaviour for free. */
export function Select({ className, invalid, children, ...props }: SelectProps) {
  return (
    <div className="relative">
      <select
        className={cn(fieldClass, 'h-9 appearance-none pr-8', className)}
        aria-invalid={invalid || undefined}
        {...props}
      >
        {children}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-ink-muted"
      >
        <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </div>
  );
}

export interface LabelProps extends ComponentProps<'label'> {
  hint?: string;
}

export function Label({ className, hint, children, ...props }: LabelProps) {
  return (
    <label className={cn('block text-[13px] font-medium text-ink', className)} {...props}>
      {children}
      {hint ? <span className="ml-1.5 font-normal text-ink-faint">{hint}</span> : null}
    </label>
  );
}

export function FieldError({ children, id }: { children?: string; id?: string }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="mt-1 text-[13px] text-danger">
      {children}
    </p>
  );
}
