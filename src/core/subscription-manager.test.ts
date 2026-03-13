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

      const dispose = mgr.subscribe('Stripe', cb);
      dispose();

      mgr.notify('Stripe', 'val');
      await Promise.resolve();
      expect(cb).not.toHaveBeenCalled();
    });

    it('is idempotent — calling dispose twice is safe', async () => {
      const mgr = new SubscriptionManager();
      const cb = vi.fn();

      const dispose = mgr.subscribe('Stripe', cb);
      dispose();
      dispose(); // should not throw

      mgr.notify('Stripe', 'val');
      await Promise.resolve();
      expect(cb).not.toHaveBeenCalled();
    });

    it('only removes the disposed subscriber, not others on same path', async () => {
      const mgr = new SubscriptionManager();
      const cb1 = vi.fn();
      const cb2 = vi.fn();

      const dispose1 = mgr.subscribe('Stripe', cb1);
      mgr.subscribe('Stripe', cb2);

      dispose1();
      mgr.notify('Stripe', 'val');

      await Promise.resolve();
      expect(cb1).not.toHaveBeenCalled();
      expect(cb2).toHaveBeenCalledWith('val');
    });

    it('cleans up Map entry when last subscriber disposes', () => {
      const mgr = new SubscriptionManager();
      const dispose = mgr.subscribe('Stripe', vi.fn());

      expect(mgr.getSubscriberCount()).toBe(1);
      dispose();
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
      const d1 = mgr.subscribe('Stripe.checkout.sessions', vi.fn());
      const d2 = mgr.subscribe('Stripe.checkout.elements', vi.fn());

      expect(mgr.hasDeepSubscribers('Stripe')).toBe(true);
      expect(mgr.hasDeepSubscribers('Stripe.checkout')).toBe(true);

      d1();
      // Still has d2 contributing to the "Stripe" and "Stripe.checkout" prefixes
      expect(mgr.hasDeepSubscribers('Stripe')).toBe(true);
      expect(mgr.hasDeepSubscribers('Stripe.checkout')).toBe(true);

      d2();
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
