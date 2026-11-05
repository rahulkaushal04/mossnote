import { createContext, useContext } from 'react';
import type { Registry } from '../commands/registry';
import type { EditorFactory } from '../editor/EditorPane';
import type { AppModel } from './model';

export interface AppCtx {
  model: AppModel;
  registry: Registry;
  createEditor?: EditorFactory;
}
export const AppContext = createContext<AppCtx | null>(null);
export function useApp(): AppCtx {
  const c = useContext(AppContext);
  if (!c) throw new Error('AppContext missing');
  return c;
}
