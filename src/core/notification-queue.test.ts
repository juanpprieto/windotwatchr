import type { SubscriberCallback } from '../types.js';
import { describe, expect, it, vi } from 'vitest';
import { notifySubscribers } from './notification-queue.js';

describe('notifySubscribers', () => {
  it('delivers value to all subscribers asynchronously', async () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const subs = new Set<SubscriberCallback>([cb1, cb2]);

    notifySubscribers(subs, 'Stripe', { id: 1 });

    // Synchronously: not yet called
    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).not.toHaveBeenCalled();

    // After microtask flush
    await Promise.resolve();
    expect(cb1).toHaveBeenCalledWith({ id: 1 });
    expect(cb2).toHaveBeenCalledWith({ id: 1 });
  });

  it('isolates callback errors — one throwing does not break others', async () => {
    const cb1 = vi.fn(() => {
      throw new Error('cb1 exploded');
    });
    const cb2 = vi.fn();
    const subs = new Set<SubscriberCallback>([cb1, cb2]);

    notifySubscribers(subs, 'Stripe', 'val');

    await Promise.resolve();
    expect(cb1).toHaveBeenCalledWith('val');
    expect(cb2).toHaveBeenCalledWith('val');
  });

  it('snapshots subscribers before scheduling to avoid mutation during iteration', async () => {
    const cb1 = vi.fn();
    const subs = new Set<SubscriberCallback>([cb1]);

    notifySubscribers(subs, 'X', 42);

    // Add a new subscriber after notify was called but before microtask runs
    const cb2 = vi.fn();
    subs.add(cb2);

    await Promise.resolve();
    expect(cb1).toHaveBeenCalledWith(42);
    // cb2 was added after snapshot — should NOT be called
    expect(cb2).not.toHaveBeenCalled();
  });

  it('handles empty subscriber set without error', async () => {
    const subs = new Set<SubscriberCallback>();
    expect(() => {
      notifySubscribers(subs, 'X', 'val');
    }).not.toThrow();
    await Promise.resolve();
  });

  it('handles re-entrancy — callback triggering another notify', async () => {
    const order: string[] = [];
    const subs2 = new Set<SubscriberCallback>();

    const cb1: SubscriberCallback = () => {
      order.push('cb1');
      // Trigger another notification from within callback
      notifySubscribers(subs2, 'Y', 'inner');
    };
    const cb2: SubscriberCallback = () => {
      order.push('cb2');
    };

    const subs1 = new Set<SubscriberCallback>([cb1]);
    subs2.add(cb2);

    notifySubscribers(subs1, 'X', 'outer');

    // Flush all microtasks
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual(['cb1', 'cb2']);
  });
});
