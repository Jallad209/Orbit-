import { DropdownMenu as MenuPrimitive } from 'radix-ui';
import { Check } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

export const DropdownMenu = MenuPrimitive.Root;
export const DropdownMenuTrigger = MenuPrimitive.Trigger;
export const DropdownMenuGroup = MenuPrimitive.Group;
export const DropdownMenuRadioGroup = MenuPrimitive.RadioGroup;

export function DropdownMenuContent({
  className,
  align = 'start',
  sideOffset = 6,
  ...props
}: ComponentProps<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-50 min-w-44 rounded-md border border-line bg-surface p-1 text-sm text-ink shadow-lg shadow-nav/10 animate-slide-down',
          className,
        )}
        {...props}
      />
    </MenuPrimitive.Portal>
  );
}

const itemClass = [
  'relative flex h-8 cursor-default items-center gap-2 rounded-[5px] px-2 outline-none select-none',
  'data-highlighted:bg-surface-2 data-highlighted:text-ink',
  'data-disabled:pointer-events-none data-disabled:opacity-50',
].join(' ');

export interface DropdownMenuItemProps extends ComponentProps<typeof MenuPrimitive.Item> {
  shortcut?: string;
  destructive?: boolean;
}

export function DropdownMenuItem({
  className,
  shortcut,
  destructive,
  children,
  ...props
}: DropdownMenuItemProps) {
  return (
    <MenuPrimitive.Item
      className={cn(
        itemClass,
        destructive && 'text-danger data-highlighted:bg-danger-soft',
        className,
      )}
      {...props}
    >
      <span className="flex-1">{children}</span>
      {shortcut ? <kbd className="font-mono text-[11px] text-ink-faint">{shortcut}</kbd> : null}
    </MenuPrimitive.Item>
  );
}

export function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: ComponentProps<typeof MenuPrimitive.CheckboxItem>) {
  return (
    <MenuPrimitive.CheckboxItem className={cn(itemClass, 'pl-7', className)} {...props}>
      <MenuPrimitive.ItemIndicator className="absolute left-2">
        <Check className="size-3.5" aria-hidden="true" />
      </MenuPrimitive.ItemIndicator>
      {children}
    </MenuPrimitive.CheckboxItem>
  );
}

export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: ComponentProps<typeof MenuPrimitive.RadioItem>) {
  return (
    <MenuPrimitive.RadioItem className={cn(itemClass, 'pl-7', className)} {...props}>
      <MenuPrimitive.ItemIndicator className="absolute left-2">
        <Check className="size-3.5" aria-hidden="true" />
      </MenuPrimitive.ItemIndicator>
      {children}
    </MenuPrimitive.RadioItem>
  );
}

export function DropdownMenuLabel({
  className,
  ...props
}: ComponentProps<typeof MenuPrimitive.Label>) {
  return (
    <MenuPrimitive.Label
      className={cn(
        'px-2 py-1.5 text-[11px] font-medium tracking-wide text-ink-faint uppercase',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof MenuPrimitive.Separator>) {
  return <MenuPrimitive.Separator className={cn('my-1 h-px bg-line', className)} {...props} />;
}
