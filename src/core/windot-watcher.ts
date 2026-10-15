import type { DisposeFunction, SubscriberCallback, WatchWindotOptions } from '../types.js';
import { DEFAULT_POLL_INTERVAL } from '../types.js';
import { dispatchWatcherEvent } from './event-dispatcher.js';
import { createProxyWrapper } from './proxy-wrapper.js';
import type { ProxyWrapper } from './proxy-wrapper.js';
import { installTrap } from './property-trap.js';
import type { TrapDispose } from './property-trap.js';
import { SubscriptionManager } from './subscription-manager.js';
import type { SubscribeOptions, Subscription, WatcherObservers } from './subscription-manager.js';
import { validateOptions } from './options.js';
import { resolvePath } from './resolve-path.js';
import { runtimeState } from './runtime-state.js';

type Strategy = 'proxy' | 'poll' | 'auto';
interface SharedPoll {
  members: Map<Subscription, number>;
  timer: ReturnType<typeof setTimeout> | undefined;
  interval: number;
}
export interface RootWatcher {
  subManager: SubscriptionManager;
  wrapper: ProxyWrapper;
  trapDispose: TrapDispose | undefined;
  polls: Map<string, SharedPoll>;
  disposers: Set<DisposeFunction>;
  mode: 'poll' | 'interception';
}
const registry = runtimeState.registry;
const WINDOW_BUILTINS = new Set<string>([
  'window', 'self', 'top', 'parent', 'frames', 'globalThis',
  'document', 'location', 'history', 'navigator', 'localStorage',
  'sessionStorage', 'name', 'length', 'closed', 'origin', 'status',
  'screen', 'frameElement', 'opener', 'customElements', 'crypto',
]);


/** Refresh interception on an explicit watch registration after ownership loss. */
function ensureTrap(rootKey: string, watcher: RootWatcher): void {
  if (watcher.mode === 'poll' || watcher.trapDispose?.ownsProperty()) {return;}
  watcher.trapDispose?.();
  watcher.trapDispose = installTrap(rootKey, watcher.subManager, watcher.wrapper);
}

/** Reconcile the fastest positive interval among live polling members. */
function reconcilePoll(path: string, watcher: RootWatcher, poll: SharedPoll): void {
  let interval = Infinity;
  for (const memberInterval of poll.members.values()) {interval = Math.min(interval, memberInterval);}
  if (interval === poll.interval && poll.timer !== undefined) {return;}
  if (poll.timer !== undefined) {clearTimeout(poll.timer);}
  poll.timer = undefined;
  poll.interval = interval;
  if (poll.members.size === 0) { watcher.polls.delete(path); return; }
  const check = (): void => {
    poll.timer = undefined;
    watcher.subManager.sample(path, poll.members.keys());
    // An error/ready observer may synchronously dispose or change membership.
    if (poll.members.size > 0 && poll.timer === undefined) {poll.timer = setTimeout(check, poll.interval);}
  };
  poll.timer = setTimeout(check, interval);
}

/**
 * Watch a path with isolated readiness and lifetime.
 * Enabled auto/poll snapshot checks continue until disposal; proxy-only
 * subscribers rely on interception. Auto+proxy can share a root, whereas
 * poll+interception conflict before resource allocation.
 * @param path - Dot path on window.
 * @param callback - Asynchronous ready callback.
 * @param options - Strategy, intervals, timeout, predicate and cancellation.
 * @param observers - Private lifecycle observers for hooks/promise adapters.
 * @returns Idempotent cleanup function.
 * @example const dispose = watch('SDK.api', callback, { once: true });
 */
export function watch(path: string, callback: SubscriberCallback, options: WatchWindotOptions & Pick<SubscribeOptions, 'delivery'> = {}, observers: WatcherObservers = {}): DisposeFunction {
  validateOptions(options);
  if (options.signal?.aborted) { observers.abort?.(); return () => {}; }
  const rootKey = path.split('.')[0]!;
  const reserved = WINDOW_BUILTINS.has(rootKey);
  const strategy: Strategy = reserved ? 'poll' : options.strategy ?? 'auto';
  const mode = strategy === 'poll' ? 'poll' : 'interception';
  let watcher = registry.get(rootKey);
  if (watcher && watcher.mode !== mode) {throw new Error(`windotwatchr: strategy conflict on "${rootKey}": poll cannot share interception`);}
  if (!watcher) {
    const subManager = new SubscriptionManager();
    watcher = { subManager, wrapper: createProxyWrapper(subManager, watchedPath => resolvePath(window, watchedPath)), trapDispose: undefined, polls: new Map(), disposers: new Set(), mode };
    registry.set(rootKey, watcher);
  }
  const owner = watcher;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let retryId: ReturnType<typeof setTimeout> | undefined;
  let resolved = false;
  let disposed = false;
  let sub: Subscription | undefined;
  let poll: SharedPoll | undefined;
  const clearDeadline = (): void => {
    if (timeoutId !== undefined) {clearTimeout(timeoutId);}
    if (retryId !== undefined) {clearTimeout(retryId);}
    timeoutId = retryId = undefined;
  };
  const dispose = (): void => {
    if (disposed) {return;}
    disposed = true;
    clearDeadline();
    sub?.dispose();
    if (poll && sub) { poll.members.delete(sub); reconcilePoll(path, owner, poll); }
    owner.disposers.delete(dispose);
    options.signal?.removeEventListener('abort', onAbort);
    // Pending registrations own the root too: a lifecycle event can dispose
    // the previous subscriber while another registration is installing a trap.
    if (owner.disposers.size === 0) {
      owner.trapDispose?.();
      if (registry.get(rootKey) === owner) {registry.delete(rootKey);}
    }
  };
  const onAbort = (): void => { dispose(); observers.abort?.(); };
  owner.disposers.add(dispose);
  try {
    if (reserved) {dispatchWatcherEvent('ww:warning', { path: rootKey, reason: 'reserved' });}
    ensureTrap(rootKey, owner);
    sub = owner.subManager.subscribe(path, value => {
      resolved = true;
      clearDeadline();
      try { callback(value); }
      finally { if (options.once) {dispose();} }
    }, {
      ...(options.ready ? { predicate: options.ready } : {}),
      ...(options.correlationId !== undefined ? { id: options.correlationId } : {}),
      delivery: options.delivery ?? 'all',
      observers,
    });
    owner.subManager.sample(path, [sub]);
    observers.refresh?.(() => { if (!disposed) {owner.subManager.sample(path, [sub!]);} });
    const interval = options.pollInterval ?? DEFAULT_POLL_INTERVAL;
    if (strategy !== 'proxy' && interval > 0 && !disposed) {
      poll = owner.polls.get(path);
      if (!poll) { poll = { members: new Map(), timer: undefined, interval: Infinity }; owner.polls.set(path, poll); }
      poll.members.set(sub, Math.ceil(interval));
      reconcilePoll(path, owner, poll);
    }
    const timeout = options.timeout ?? 0;
    if (timeout > 0) {
      const retries = options.retries ?? 0;
      let attempts = 0;
      const reportTimeout = (): void => {
        if (resolved || disposed) {return;}
        const detail = { path, attempts, elapsed: timeout, id: sub!.id };
        dispatchWatcherEvent('ww:timeout', detail);
        if (disposed || resolved) {return;}
        observers.timeout?.(detail);
        if (disposed || resolved || attempts >= retries) {return;}
        retryId = setTimeout(() => {
          retryId = undefined;
          if (disposed || resolved) {return;}
          attempts++;
          owner.subManager.sample(path, [sub!]);
          // Delivery runs before the next retry; polling only reports snapshots.
          void Promise.resolve().then(reportTimeout);
        }, interval > 0 ? Math.ceil(interval) : DEFAULT_POLL_INTERVAL);
      };
      timeoutId = setTimeout(() => { timeoutId = undefined; reportTimeout(); }, Math.ceil(timeout));
    }
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) {onAbort();}
    return dispose;
  } catch (error) { dispose(); throw error; }
}

/**
 * Release all test registrations, including callbacks' timers/abort listeners.
 * @example afterEach(() => resetRegistry());
 */
export function resetRegistry(): void {
  for (const watcher of Array.from(registry.values())) {
    for (const dispose of Array.from(watcher.disposers)) {dispose();}
  }
  registry.clear();
}
