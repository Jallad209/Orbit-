import { useEffect, type ReactNode } from 'react';
import { HotkeyContext, hotkeys, type HotkeyRegistry } from './hotkeys';

interface Props {
  registry?: HotkeyRegistry;
  children: ReactNode;
}

/**
 * Attaches a hotkey registry to the window for the life of the app and makes
 * it the registry `useHotkey` binds to. Tests pass their own registry.
 */
export function HotkeyProvider({ registry = hotkeys, children }: Props) {
  useEffect(() => registry.attach(window), [registry]);
  return <HotkeyContext.Provider value={registry}>{children}</HotkeyContext.Provider>;
}
