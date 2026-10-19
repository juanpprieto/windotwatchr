import type { SubscriptionManager } from './subscription-manager.js';
import { resolvePath } from './resolve-path.js';
import { registerProxy, unwrapProxy } from './proxy-identity.js';

/**
 * Build one identity-preserving wrapper per raw object, with all subscribed alias
 * routes. Native writes happen first; watcher reads cannot make them throw.
 * @param subManager - Independent subscription routing.
 * @param readPath - Optional live root lookup for stale-route suppression.
 * @returns A lazy object/function wrapper.
 * @example const wrapper = createProxyWrapper(manager);
 */
export function createProxyWrapper(subManager: SubscriptionManager, readPath?: (path: string) => unknown): ProxyWrapper {
  return new ProxyWrapperImpl(subManager, readPath);
}

/** Object/function interception; sealed/frozen values require snapshot coverage. */
export interface ProxyWrapper {
  /**
   * Register a route and return the stable proxy, or null for sealed/frozen data.
   * @param target - Raw SDK object or function.
   * @param parentPath - Dot path for this object.
   * @returns Cached wrapper or null.
   */
  wrap(target: object, parentPath: string): object | null;
}

class ProxyWrapperImpl implements ProxyWrapper {
  private proxyCache = new WeakMap<object, object>();
  private routes = new WeakMap<object, Set<string>>();
  private roots: Record<string, unknown> = Object.create(null);

  constructor(private subManager: SubscriptionManager, private readPath?: (path: string) => unknown) {}

  wrap(target: object, parentPath: string): object | null {
    target = unwrapProxy(target) as object;
    if (target === null || (typeof target !== 'object' && typeof target !== 'function')) {return null;}
    if (Object.isFrozen(target) || Object.isSealed(target)) {return null;}
    if (!this.readPath && !parentPath.includes('.')) {this.roots[parentPath] = target;}
    let paths = this.routes.get(target);
    if (!paths) { paths = new Set(); this.routes.set(target, paths); }
    paths.add(parentPath);
    const cached = this.proxyCache.get(target);
    if (cached) {return cached;}
    const proxy = this.createProxy(target, paths);
    this.proxyCache.set(target, proxy);
    registerProxy(proxy, target);
    return proxy;
  }

  /** Drop unsubscribed routes; never retain arbitrary unobserved property names. */
  private activeRoutes(paths: Set<string>): Iterable<string> {
    for (const path of paths) {
      if (!this.subManager.hasRouteSubscribers(path)) {paths.delete(path);}
    }
    return paths;
  }

  /** Resolve aliases against current SDK data so detached objects cannot notify. */
  private notify(target: object, paths: Set<string>, prop: string): void {
    for (const path of this.activeRoutes(paths)) {
      let current: unknown;
      try { current = this.readPath ? this.readPath(path) : resolvePath(this.roots, path); }
      catch (error) { this.subManager.notifyResolved(path, () => { throw error; }); continue; }
      if (unwrapProxy(current) !== target) { paths.delete(path); continue; }
      const fullPath = `${path}.${prop}`;
      this.subManager.notifyResolved(fullPath, () => {
        const value = Reflect.get(target, prop, target);
        if (value !== null && (typeof value === 'object' || typeof value === 'function') && this.subManager.hasDeepSubscribers(fullPath)) {
          return this.wrap(value, fullPath) ?? value;
        }
        return value;
      });
    }
  }

  private createProxy(source: object, paths: Set<string>): object {
    return new Proxy(source, {
      set: (target, prop, value) => {
        // A raw receiver avoids the implicit defineProperty trap and retains
        // native inherited setter lookup. Unwrap values before storing them.
        const result = Reflect.set(target, prop, unwrapProxy(value), target);
        if (result && typeof prop === 'string') {this.notify(target, paths, prop);}
        return result;
      },
      defineProperty: (target, prop, descriptor) => {
        let stored = descriptor;
        if ('value' in descriptor) {
          const previous = Reflect.getOwnPropertyDescriptor(target, prop);
          const configurable = descriptor.configurable ?? previous?.configurable ?? false;
          const writable = descriptor.writable ?? (previous && 'writable' in previous ? previous.writable : false);
          // Proxy invariants require exact identity for a locked data value.
          // Such explicit descriptors must retain the caller's supplied value.
          if (configurable || writable) {stored = { ...descriptor, value: unwrapProxy(descriptor.value) };}
        }
        const result = Reflect.defineProperty(target, prop, stored);
        if (result && typeof prop === 'string') {this.notify(target, paths, prop);}
        return result;
      },
      deleteProperty: (target, prop) => {
        const result = Reflect.deleteProperty(target, prop);
        if (result && typeof prop === 'string') {this.notify(target, paths, prop);}
        return result;
      },
      get: (target, prop, receiver) => {
        const value = Reflect.get(target, prop, receiver);
        if (typeof prop === 'symbol' || value === null || (typeof value !== 'object' && typeof value !== 'function') || !this.subManager.hasAnyDeepSubscribers()) {return value;}
        const descriptor = Reflect.getOwnPropertyDescriptor(target, prop);
        if (descriptor && !descriptor.configurable && 'value' in descriptor && !descriptor.writable) {return value;}
        let wrapped: object | null = null;
        for (const path of this.activeRoutes(paths)) {
          const fullPath = `${path}.${prop}`;
          if (this.subManager.hasDeepSubscribers(fullPath)) {wrapped = this.wrap(value, fullPath);}
        }
        return wrapped ?? value;
      },
    });
  }
}
