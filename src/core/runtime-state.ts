import type { RootWatcher } from './windot-watcher.js';

interface RuntimeState {
  registry: Map<string, RootWatcher>;
  originals: WeakMap<object, object>;
  sequence: number;
}

/** Core and React share this module in the single ESM dependency graph. */
export const runtimeState: RuntimeState = { registry: new Map(), originals: new WeakMap(), sequence: 0 };
