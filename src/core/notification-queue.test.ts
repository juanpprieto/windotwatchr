import { describe, expect, it, vi } from 'vitest';
import { scheduleDeliveries } from './notification-queue.js';
import type { Subscription } from './subscription-manager.js';

/**
 * Build a Subscription test double. Mirrors the real record shape so the
 * queue exercises production readiness, disposal and event identity.
 */
function makeSub(
  callback: (value: unknown) => void,
  overrides: Partial<Subscription> = {},
): Subscription {
  return {
    callback,
    predicate: (v) => v !== null && v !== undefined,
    id: 'test-id',
    disposed: false,
    delivery: 'all',
    hasObserved: false, observedValue: undefined, observedReady: false, detectionFailed: false, observers: {},
    dispose: () => {},
    ...overrides,
  };
}

describe('scheduleDeliveries', () => {
  it('delivers value to all subscriptions asynchronously', async () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const sub1 = makeSub(cb1);
    const sub2 = makeSub(cb2);

    scheduleDeliveries([
      { sub: sub1, path: 'Stripe', value: { id: 1 } },
      { sub: sub2, path: 'Stripe', value: { id: 1 } },
    ]);

    // Synchronously: not yet called
    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).not.toHaveBeenCalled();

    await Promise.resolve();
    expect(cb1).toHaveBeenCalledWith({ id: 1 });
    expect(cb2).toHaveBeenCalledWith({ id: 1 });
  });

  it('isolates callback errors — one throwing does not break others', async () => {
    const cb1 = vi.fn(() => { throw new Error('cb1 exploded'); });
    const cb2 = vi.fn();

    scheduleDeliveries([
      { sub: makeSub(cb1), path: 'Stripe', value: 'val' },
      { sub: makeSub(cb2), path: 'Stripe', value: 'val' },
    ]);

    await Promise.resolve();
    expect(cb1).toHaveBeenCalledWith('val');
    expect(cb2).toHaveBeenCalledWith('val');
  });

  it('skips a subscription disposed between schedule and delivery', async () => {
    const cb = vi.fn();
    const sub = makeSub(cb);

    scheduleDeliveries([{ sub, path: 'SDK', value: 'val' }]);
    // Dispose lands before the microtask runs
    sub.disposed = true;

    await Promise.resolve();
    expect(cb).not.toHaveBeenCalled();
  });

  it('preserves separate intercepted occurrences even for equal values', async () => {
    const cb = vi.fn();
    const sub = makeSub(cb);
    const value = { same: true };

    scheduleDeliveries([{ sub, path: 'SDK', value }]);
    await Promise.resolve();
    expect(cb).toHaveBeenCalledTimes(1);

    // Each scheduled record is a distinct occurrence; snapshot dedup happens before queueing.
    scheduleDeliveries([{ sub, path: 'SDK', value }]);
    await Promise.resolve();
    expect(cb).toHaveBeenCalledTimes(2);

    // A different reference → delivered
    scheduleDeliveries([{ sub, path: 'SDK', value: { same: true } }]);
    await Promise.resolve();
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it('handles empty delivery list without error', async () => {
    expect(() => scheduleDeliveries([])).not.toThrow();
    await Promise.resolve();
  });

  it('snapshots the batch before scheduling', async () => {
    const cb1 = vi.fn();
    const deliveries = [{ sub: makeSub(cb1), path: 'X', value: 42 }];
    scheduleDeliveries(deliveries);

    // Mutating the array after the call must not add deliveries
    const cb2 = vi.fn();
    deliveries.push({ sub: makeSub(cb2), path: 'X', value: 99 });

    await Promise.resolve();
    expect(cb1).toHaveBeenCalledWith(42);
    expect(cb2).not.toHaveBeenCalled();
  });

  it('dispatches ww:error carrying the subscription id when a callback throws', async () => {
    const error = new Error('boom');
    const sub = makeSub(() => { throw error; }, { id: 'sub-77' });

    const listener = vi.fn();
    window.addEventListener('ww:error', listener);

    scheduleDeliveries([{ sub, path: 'SDK', value: 'val' }]);
    await Promise.resolve();

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0]![0] as CustomEvent;
    expect(event.detail).toEqual({ path: 'SDK', error, id: 'sub-77' });

    window.removeEventListener('ww:error', listener);
  });

  it('ww:ready detail contains path, value, and id', async () => {
    const sub = makeSub(vi.fn(), { id: 'sub-9' });

    const listener = vi.fn();
    window.addEventListener('ww:ready', listener);

    scheduleDeliveries([{ sub, path: 'Stripe.checkout', value: { sdk: true } }]);
    await Promise.resolve();

    const event = listener.mock.calls[0]![0] as CustomEvent;
    expect(event.detail).toEqual({ path: 'Stripe.checkout', value: { sdk: true }, id: 'sub-9' });

    window.removeEventListener('ww:ready', listener);
  });

  it('handles re-entrancy — a callback scheduling another delivery', async () => {
    const order: string[] = [];
    const inner = makeSub(() => { order.push('inner'); });
    const outer = makeSub(() => {
      order.push('outer');
      scheduleDeliveries([{ sub: inner, path: 'Y', value: 'v' }]);
    });

    scheduleDeliveries([{ sub: outer, path: 'X', value: 'v' }]);

    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual(['outer', 'inner']);
  });
});
