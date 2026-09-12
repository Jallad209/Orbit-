import { Dialog as DialogPrimitive } from 'radix-ui';
import { X } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

export const Drawer = DialogPrimitive.Root;
export const DrawerTrigger = DialogPrimitive.Trigger;
export const DrawerClose = DialogPrimitive.Close;

/** Right-hand panel for editing a record without leaving the page. */
export function DrawerContent({
  className,
  children,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-nav/30 animate-fade-in" />
      <DialogPrimitive.Content
        className={cn(
          'fixed top-0 right-0 z-50 flex h-dvh w-full max-w-md flex-col border-l border-line bg-surface shadow-2xl shadow-nav/30 focus:outline-none',
          'animate-slide-in-right',
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          className="absolute top-3 right-3 grid size-8 place-items-center rounded-md text-ink-muted hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-lime-2"
          aria-label="Close"
        >
          <X className="size-4" aria-hidden="true" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DrawerHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('border-b border-line px-6 py-4 pr-12', className)} {...props} />;
}

export function DrawerTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn('text-h1 font-semibold tracking-tight text-ink', className)}
      {...props}
    />
  );
}

export function DrawerBody({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex-1 overflow-y-auto px-6 py-4', className)} {...props} />;
}

export function DrawerFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex justify-end gap-2 border-t border-line px-6 py-3', className)}
      {...props}
    />
  );
}
