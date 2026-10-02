import { describe, expect, it, vi } from 'vitest';
import { SubscriptionManager } from './subscription-manager.js';

describe('SubscriptionManager', () => {
  describe('subscribe / notify', () => {
    it('delivers notifications to subscribed callbacks', async () => {
      const mgr = new SubscriptionManager();
      const cb = vi.fn();

      mgr.subscribe('Stripe', cb);
      mgr.notify('Stripe', { id: 1 });

      await Promise.resolve();
      expect(cb).toHaveBeenCalledWith({ id: 1 });
    });

    it('fans out to multiple subscribers on same path', async () => {
      const mgr = new SubscriptionManager();
      const cb1 = vi.fn();
      const cb2 = vi.fn();

      mgr.subscribe('Stripe.checkout', cb1);
      mgr.subscribe('Stripe.checkout', cb2);
      mgr.notify('Stripe.checkout', 'ready');

      await Promise.resolve();
      expect(cb1).toHaveBeenCalledWith('ready');
      expect(cb2).toHaveBeenCalledWith('ready');
    });

    it('does not cross-notify between different paths', async () => {
      const mgr = new SubscriptionManager();
      const cbA = vi.fn();
      const cbB = vi.fn();

      mgr.subscribe('Stripe.checkout', cbA);
      mgr.subscribe('Stripe.elements', cbB);
      mgr.notify('Stripe.checkout', 'checkout-val');

      await Promise.resolve();
      expect(cbA).toHaveBeenCalledWith('checkout-val');
      expect(cbB).not.toHaveBeenCalled();
    });

    it('skips notification when no subscribers exist for path', () => {
      const mgr = new SubscriptionManager();
      expect(() => {
        mgr.notify('NonExistent', 'val');
      }).not.toThrow();
    });
  });

  describe('dispose', () => {
    it('removes subscriber on dispose', async () => {
      const mgr = new SubscriptionManager();
      const cb = vi.fn();

      const sub = mgr.subscribe('Stripe', cb);
      sub.dispose();

      mgr.notify('Stripe', 'val');
      await Promise.resolve();
      expect(cb).not.toHaveBeenCalled();
    });

    it('is idempotent — calling dispose twice is safe', async () => {
      const mgr = new SubscriptionManager();
      const cb = vi.fn();

      const sub = mgr.subscribe('Stripe', cb);
      sub.dispose();
      sub.dispose(); // should not throw

      mgr.notify('Stripe', 'val');
      await Promise.resolve();
      expect(cb).not.toHaveBeenCalled();
    });

    it('only removes the disposed subscriber, not others on same path', async () => {
      const mgr = new SubscriptionManager();
      const cb1 = vi.fn();
      const cb2 = vi.fn();

      const sub1 = mgr.subscribe('Stripe', cb1);
      mgr.subscribe('Stripe', cb2);

      sub1.dispose();
      mgr.notify('Stripe', 'val');

      await Promise.resolve();
      expect(cb1).not.toHaveBeenCalled();
      expect(cb2).toHaveBeenCalledWith('val');
    });

    it('cleans up Map entry when last subscriber disposes', () => {
      const mgr = new SubscriptionManager();
      const sub = mgr.subscribe('Stripe', vi.fn());

      expect(mgr.getSubscriberCount()).toBe(1);
      sub.dispose();
      expect(mgr.getSubscriberCount()).toBe(0);
    });
  });

  describe('hasDeepSubscribers', () => {
    it('returns true for ancestor prefixes of a subscribed path', () => {
      const mgr = new SubscriptionManager();
      mgr.subscribe('Stripe.checkout.sessions', vi.fn());

      expect(mgr.hasDeepSubscribers('Stripe')).toBe(true);
      expect(mgr.hasDeepSubscribers('Stripe.checkout')).toBe(true);
    });

    it('returns false for the leaf path itself', () => {
      const mgr = new SubscriptionManager();
      mgr.subscribe('Stripe.checkout', vi.fn());

      // "Stripe.checkout" is the leaf — not a prefix of anything deeper
      expect(mgr.hasDeepSubscribers('Stripe.checkout')).toBe(false);
    });

    it('returns false for unrelated paths', () => {
      const mgr = new SubscriptionManager();
      mgr.subscribe('Stripe.checkout', vi.fn());

      expect(mgr.hasDeepSubscribers('Google')).toBe(false);
      expect(mgr.hasDeepSubscribers('Stripe.elements')).toBe(false);
    });

    it('decrements prefix counts on dispose and removes when zero', () => {
      const mgr = new SubscriptionManager();
      const s1 = mgr.subscribe('Stripe.checkout.sessions', vi.fn());
      const s2 = mgr.subscribe('Stripe.checkout.elements', vi.fn());

      expect(mgr.hasDeepSubscribers('Stripe')).toBe(true);
      expect(mgr.hasDeepSubscribers('Stripe.checkout')).toBe(true);

      s1.dispose();
      // Still has s2 contributing to the "Stripe" and "Stripe.checkout" prefixes
      expect(mgr.hasDeepSubscribers('Stripe')).toBe(true);
      expect(mgr.hasDeepSubscribers('Stripe.checkout')).toBe(true);

      s2.dispose();
      expect(mgr.hasDeepSubscribers('Stripe')).toBe(false);
      expect(mgr.hasDeepSubscribers('Stripe.checkout')).toBe(false);
    });

    it('handles root-only subscriptions (no dot) correctly', () => {
      const mgr = new SubscriptionManager();
      mgr.subscribe('Stripe', vi.fn());

      // No prefixes for a root-only path
      expect(mgr.hasDeepSubscribers('Stripe')).toBe(false);
    });
  });

  describe('descendant resolution', () => {
    it('resolves a sub-path subscriber when the parent is assigned wholesale', async () => {
      const mgr = new SubscriptionManager();
      const cb = vi.fn();
      mgr.subscribe('SDK.checkout', cb);

      // Parent assigned as a whole, child already present
      mgr.notify('SDK', { checkout: { ready: true } });

      await Promise.resolve();
      expect(cb).toHaveBeenCalledWith({ ready: true });
    });

    it('resolves multi-level descendants', async () => {
      const mgr = new SubscriptionManager();
      const cb = vi.fn();
      mgr.subscribe('SDK.a.b', cb);

      mgr.notify('SDK', { a: { b: 42 } });

      await Promise.resolve();
      expect(cb).toHaveBeenCalledWith(42);
    });

    it('does not deliver descendant when its resolved value fails the predicate', async () => {
      const mgr = new SubscriptionManager();
      const cb = vi.fn();
      mgr.subscribe('SDK.checkout', cb, { predicate: (v) => v !== null && v !== undefined });

      mgr.notify('SDK', { other: 1 }); // no `checkout` key → undefined

      await Promise.resolve();
      expect(cb).not.toHaveBeenCalled();
    });

    it('honors per-subscription predicate on the exact path', async () => {
      const mgr = new SubscriptionManager();
      const cb = vi.fn();
      mgr.subscribe('SDK', cb, { predicate: (v: any) => v?.loaded === true });

      mgr.notify('SDK', { loaded: false });
      await Promise.resolve();
      expect(cb).not.toHaveBeenCalled();

      mgr.notify('SDK', { loaded: true });
      await Promise.resolve();
      expect(cb).toHaveBeenCalledWith({ loaded: true });
    });

    it('routes different predicates on the same path independently', async () => {
      const mgr = new SubscriptionManager();
      const strict = vi.fn();
      const loose = vi.fn();
      mgr.subscribe('SDK', strict, { predicate: (v: any) => v?.ready === true });
      mgr.subscribe('SDK', loose, { predicate: (v) => v !== null && v !== undefined });

      mgr.notify('SDK', { ready: false });
      await Promise.resolve();
      expect(strict).not.toHaveBeenCalled();
      expect(loose).toHaveBeenCalledWith({ ready: false });
    });
  });

  describe('hasAnyDeepSubscribers', () => {
    it('is false with only root subscriptions', () => {
      const mgr = new SubscriptionManager();
      mgr.subscribe('SDK', vi.fn());
      expect(mgr.hasAnyDeepSubscribers()).toBe(false);
    });

    it('is true once a nested-path subscription exists', () => {
      const mgr = new SubscriptionManager();
      const sub = mgr.subscribe('SDK.checkout', vi.fn());
      expect(mgr.hasAnyDeepSubscribers()).toBe(true);
      sub.dispose();
      expect(mgr.hasAnyDeepSubscribers()).toBe(false);
    });
  });

  describe('getSubscriberCount', () => {
    it('returns total across all paths', () => {
      const mgr = new SubscriptionManager();
      mgr.subscribe('Stripe.checkout', vi.fn());
      mgr.subscribe('Stripe.elements', vi.fn());
      mgr.subscribe('Google.maps', vi.fn());

      expect(mgr.getSubscriberCount()).toBe(3);
    });

    it('returns 0 when empty', () => {
      const mgr = new SubscriptionManager();
      expect(mgr.getSubscriberCount()).toBe(0);
    });
  });
});
