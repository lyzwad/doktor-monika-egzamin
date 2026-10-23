/**
 * Wiązanie kontrolera z React: kontekst + hooki oparte o `useSyncExternalStore`.
 */
import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { AppController, AppState } from './controller';

const ControllerContext = createContext<AppController | null>(null);

export function ControllerProvider({ controller, children }: { controller: AppController; children: ReactNode }) {
  return <ControllerContext.Provider value={controller}>{children}</ControllerContext.Provider>;
}

/** Kontroler z kontekstu (akcje). */
export function useController(): AppController {
  const controller = useContext(ControllerContext);
  if (!controller) throw new Error('useController: brak ControllerProvider');
  return controller;
}

/** Bieżący stan aplikacji (re-render przy każdej publikacji nowego stanu). */
export function useAppState(): AppState {
  const controller = useController();
  return useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
}
