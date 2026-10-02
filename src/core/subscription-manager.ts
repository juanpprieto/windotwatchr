import type { DisposeFunction, SubscriberCallback } from '../types.js';
import { defaultReadyPredicate } from '../types.js';
import { dispatchWatcherEvent } from './event-dispatcher.js';
import { scheduleDeliveries } from './notification-queue.js';
import { resolvePath } from './resolve-path.js';
import { unwrapProxy } from './proxy-identity.js';
import { runtimeState } from './runtime-state.js';

/** Internal observers receive lifecycle changes from their own registration. */
export interface WatcherObservers {
  error?: (error: unknown) => void;
  timeout?: (detail: { path: string; attempts: number; elapsed: number; id: string }) => void;
  refresh?: (sample: () => void) => void;
  notReady?: () => void;
  abort?: () => void;
}

/** A subscription owns its readiness, snapshot state, error episode and lifetime. */
export interface Subscription {
  callback: SubscriberCallback;
  predicate: (value: unknown) => boolean;
  id: string;
  disposed: boolean;
  hasObserved: boolean;
  observedValue: unknown;
  observedReady: boolean;
  detectionFailed: boolean;
  observers: WatcherObservers;
  dispose: DisposeFunction;
}

/** Registration-time options; correlation labels do not define internal identity. */
export interface SubscribeOptions {
  predicate?: (value: unknown) => boolean;
  id?: string;
  observers?: WatcherObservers;
}

/**
 * Report the first error in a consecutive detection-failure episode.
 * A successful getter/predicate evaluation resets the episode. Callback errors
 * are reported separately for each callback occurrence.
 * @param sub - Affected subscription.
 * @param path - Watched path.
 * @param error - First thrown value in this episode.
 */
export function reportDetectionError(sub: Subscription, path: string, error: unknown): void {
  if (sub.disposed || sub.detectionFailed) {return;}
  sub.detectionFailed = true;
  dispatchWatcherEvent('ww:error', { path, error, id: sub.id });
  if (!sub.disposed) {sub.observers.error?.(error);}
}

/**
 * Evaluate readiness in isolation, including immediately before delivery.
 * @param sub - Subscription whose predicate applies.
 * @param path - Watched path for error reporting.
 * @param value - Candidate value.
 * @returns True only when the active predicate succeeds.
 */
export function isReady(sub: Subscription, path: string, value: unknown): boolean {
  if (sub.disposed) {return false;}
  try {
    const ready = sub.predicate(value);
    sub.detectionFailed = false;
    if (!ready && sub.observedReady) {
      sub.observedReady = false;
      sub.observers.notReady?.();
    }
    return ready;
  } catch (error) {
    sub.observedReady = false;
    reportDetectionError(sub, path, error);
    return false;
  }
}

/**
 * Routes intercepted occurrences and poll snapshots to independent subscriptions.
 * @example const manager = new SubscriptionManager(); manager.subscribe('SDK.api', callback);
 */
export class SubscriptionManager {
  private subscribers = new Map<string, Set<Subscription>>();
  private deepPrefixes = new Map<string, number>();

  /**
   * Register one independent lifetime.
   * @param path - Dot path.
   * @param callback - Callback invoked asynchronously when ready.
   * @param options - Predicate, public correlation label and private observers.
   * @returns Subscription with idempotent disposal.
   */
  subscribe(path: string, callback: SubscriberCallback, options?: SubscribeOptions): Subscription {
    let set = this.subscribers.get(path);
    if (!set) { set = new Set(); this.subscribers.set(path, set); }
    const sub: Subscription = {
      callback, predicate: options?.predicate ?? defaultReadyPredicate,
      id: options?.id ?? `ww_${++runtimeState.sequence}`, disposed: false,
      hasObserved: false, observedValue: undefined, observedReady: false,
      detectionFailed: false, observers: options?.observers ?? {}, dispose: () => {},
    };
    set.add(sub);
    this.addPrefixes(path);
    sub.dispose = () => {
      if (sub.disposed) {return;}
      sub.disposed = true;
      set.delete(sub);
      if (set.size === 0) {this.subscribers.delete(path);}
      this.removePrefixes(path);
    };
    return sub;
  }

  /**
   * Observe a value: assignments always represent occurrences; equal snapshots
   * only deliver on first observation or a not-ready→ready transition.
   * @param sub - Target subscription.
   * @param path - Watched path.
   * @param value - Candidate value.
   * @param source - Intercepted occurrence or snapshot.
   */
  observe(sub: Subscription, path: string, value: unknown, source: 'assignment' | 'snapshot' = 'snapshot'): void {
    const previousReady = sub.observedReady;
    const identity = unwrapProxy(value);
    const changed = !sub.hasObserved || !Object.is(sub.observedValue, identity);
    const ready = isReady(sub, path, value);
    sub.hasObserved = true;
    sub.observedValue = identity;
    sub.observedReady = ready;
    if (ready && (source === 'assignment' || changed || !previousReady)) {
      scheduleDeliveries([{ sub, path, value }]);
    }
  }

  /**
   * Resolve one path once and observe it for selected subscribers.
   * @param path - Full path on window.
   * @param selected - Poll members or a registration/retry's own subscription.
   */
  sample(path: string, selected: Iterable<Subscription>): void {
    let value: unknown;
    try { value = resolvePath(window, path); }
    catch (error) {
      for (const sub of selected) { sub.observedReady = false; reportDetectionError(sub, path, error); }
      return;
    }
    for (const sub of selected) {this.observe(sub, path, value);}
  }

  /**
   * Read the result of a successful SDK mutation without leaking observation
   * failures into that mutation. Ancestor readiness still samples independently.
   * @param path - Mutated path.
   * @param read - Native resulting lookup.
   */
  notifyResolved(path: string, read: () => unknown): void {
    let value: unknown;
    try { value = read(); }
    catch (error) {
      for (const [watchedPath, set] of this.subscribers) {
        if (watchedPath === path || watchedPath.startsWith(`${path}.`)) {
          for (const sub of set) { sub.observedReady = false; reportDetectionError(sub, watchedPath, error); }
        } else if (path.startsWith(`${watchedPath}.`)) {this.sample(watchedPath, set);}
      }
      return;
    }
    this.notify(path, value);
  }

  /**
   * Route root/middle/leaf changes, descendants, and ancestor readiness.
   * @param path - Changed path.
   * @param value - New value.
   * @param source - Occurrence for writes, snapshot for installation/read checks.
   */
  notify(path: string, value: unknown, source: 'assignment' | 'snapshot' = 'assignment'): void {
    for (const [watchedPath, set] of this.subscribers) {
      if (watchedPath === path) {
        for (const sub of set) {this.observe(sub, watchedPath, value, source);}
      } else if (watchedPath.startsWith(`${path}.`)) {
        let child: unknown;
        try { child = resolvePath({ value }, `value.${watchedPath.slice(path.length + 1)}`); }
        catch (error) {
          for (const sub of set) { sub.observedReady = false; reportDetectionError(sub, watchedPath, error); }
          continue;
        }
        for (const sub of set) {this.observe(sub, watchedPath, child, source);}
      } else if (path.startsWith(`${watchedPath}.`)) {
        this.sample(watchedPath, set);
      }
    }
  }

  /**
   * Check whether any subscriber watches a path deeper than `pathPrefix`.
   *
   * Used by ProxyWrapper's `get` trap to decide whether to create a nested
   * proxy. O(1) lookup via the maintained `deepPrefixes` Map.
   *
   * @param pathPrefix - Ancestor path to check (e.g., `"Stripe"`).
   * @returns `true` if at least one subscriber watches a deeper path.
   */
  hasDeepSubscribers(pathPrefix: string): boolean {
    return (this.deepPrefixes.get(pathPrefix) ?? 0) > 0;
  }

  /**
   * Whether an object route still belongs to a live registration.
   * @param path - Object prefix.
   * @returns True for exact or descendant registrations.
   */
  hasRouteSubscribers(path: string): boolean {
    return this.hasDeepSubscribers(path) || this.subscribers.has(path);
  }

  /**
   * Whether *any* deep-path subscriber exists at all.
   *
   * O(1) escape hatch for ProxyWrapper's `get` trap: when this is `false`
   * there is no reason to compute a path string or consult
   * {@link hasDeepSubscribers} on a hot property read.
   *
   * @returns `true` if at least one subscription has a nested path.
   */
  hasAnyDeepSubscribers(): boolean {
    return this.deepPrefixes.size > 0;
  }

  /**
   * Total number of individual subscriptions across all paths.
   *
   * Used by WindotWatcher for singleton ref-counting. When this reaches 0,
   * the PropertyTrap and ProxyWrapper for the root key can be torn down.
   *
   * @returns Total subscriber count across all paths.
   */
  getSubscriberCount(): number {
    let count = 0;
    for (const set of this.subscribers.values()) {
      count += set.size;
    }
    return count;
  }

  /**
   * Increment ref-counts for all ancestor prefixes of a path.
   *
   * For path `"Stripe.checkout.sessions"`, increments counts for
   * `"Stripe"` and `"Stripe.checkout"`.
   *
   * @param path - The subscriber's dot-notation path.
   */
  private addPrefixes(path: string): void {
    const parts = path.split('.');
    for (let i = 1; i < parts.length; i++) {
      const prefix = parts.slice(0, i).join('.');
      this.deepPrefixes.set(prefix, (this.deepPrefixes.get(prefix) ?? 0) + 1);
    }
  }

  /**
   * Decrement ref-counts for all ancestor prefixes of a path.
   *
   * Removes entries that reach 0 to avoid memory leaks.
   *
   * @param path - The subscriber's dot-notation path.
   */
  private removePrefixes(path: string): void {
    const parts = path.split('.');
    for (let i = 1; i < parts.length; i++) {
      const prefix = parts.slice(0, i).join('.');
      const count = (this.deepPrefixes.get(prefix) ?? 0) - 1;
      if (count <= 0) {
        this.deepPrefixes.delete(prefix);
      } else {
        this.deepPrefixes.set(prefix, count);
      }
    }
  }
}
