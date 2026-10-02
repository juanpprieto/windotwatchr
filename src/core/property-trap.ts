import type { DisposeFunction } from '../types.js';
import { dispatchWatcherEvent } from './event-dispatcher.js';
import type { ProxyWrapper } from './proxy-wrapper.js';
import type { SubscriptionManager } from './subscription-manager.js';
import { unwrapProxy } from './proxy-identity.js';

/** A disposer can test ownership before a registry entry is reused. */
export type TrapDispose = DisposeFunction & { ownsProperty(): boolean };

/**
 * Intercept configurable roots while preserving native descriptor semantics.
 * Restoration only changes a descriptor still owned by this trap, and always
 * restores the raw SDK value. Accessor setters/getters remain authoritative.
 * @param rootKey - Window property to intercept.
 * @param subManager - Subscription routing.
 * @param proxyWrapper - Wrapper/identity metadata for this root.
 * @returns Idempotent disposer with an ownership check.
 * @example const dispose = installTrap('SDK', manager, wrapper); dispose();
 */
export function installTrap(rootKey: string, subManager: SubscriptionManager, proxyWrapper: ProxyWrapper): TrapDispose {
  const original = Object.getOwnPropertyDescriptor(window, rootKey);
  let raw: unknown;
  let assigned = false;
  let disposed = false;

  const readOriginal = (): unknown => original && 'value' in original ? raw : original?.get?.call(window);
  const wrap = (value: unknown): unknown => {
    value = unwrapProxy(value);
    if (disposed) {return value;}
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {return value;}
    const proxy = proxyWrapper.wrap(value, rootKey);
    if (proxy) {return proxy;}
    return value;
  };
  const getter = (): unknown => {
    if (original && !('value' in original)) {raw = readOriginal();}
    return wrap(raw);
  };
  const canWrite = !original || ('value' in original ? original.writable !== false : original.set !== undefined);
  const setter = canWrite ? (value: unknown): void => {
    value = unwrapProxy(value);
    if (original && !('value' in original)) {
      original.set!.call(window, value);
      assigned = true;
      subManager.notifyResolved(rootKey, () => { raw = readOriginal(); return wrap(raw); });
      return;
    } else {raw = value;}
    assigned = true;
    const observed = wrap(raw);
    if (raw !== null && (typeof raw === 'object' || typeof raw === 'function') && observed === raw && (Object.isFrozen(raw) || Object.isSealed(raw))) {
      dispatchWatcherEvent('ww:warning', { path: rootKey, reason: Object.isFrozen(raw) ? 'frozen' : 'sealed' });
    }
    subManager.notify(rootKey, observed);
  } : undefined;
  const ownsProperty = (): boolean => {
    const descriptor = Object.getOwnPropertyDescriptor(window, rootKey);
    return !disposed && descriptor?.configurable === true && descriptor.get === getter && descriptor.set === setter;
  };

  try {
    raw = original && 'value' in original ? unwrapProxy(original.value) : original?.get?.call(window);
    Object.defineProperty(window, rootKey, {
      configurable: true, enumerable: original?.enumerable ?? true, get: getter,
      ...(setter ? { set: setter } : {}),
    });
    const observed = wrap(raw);
    if (raw !== null && (typeof raw === 'object' || typeof raw === 'function') && observed === raw && (Object.isFrozen(raw) || Object.isSealed(raw))) {
      dispatchWatcherEvent('ww:warning', { path: rootKey, reason: Object.isFrozen(raw) ? 'frozen' : 'sealed' });
    }
    subManager.notify(rootKey, observed, 'snapshot');
  } catch {
    dispatchWatcherEvent('ww:warning', { path: rootKey, reason: 'defineProperty failed' });
  }

  const dispose = (): void => {
    if (disposed) {return;}
    const owns = ownsProperty();
    disposed = true;
    if (!owns) {return;}
    if (original) {
      Object.defineProperty(window, rootKey, 'value' in original ? { ...original, value: raw } : original);
    } else {
      delete (window as unknown as Record<string, unknown>)[rootKey];
      if (assigned) {Object.defineProperty(window, rootKey, { value: raw, writable: true, enumerable: true, configurable: true });}
    }
  };
  return Object.assign(dispose, { ownsProperty });
}
