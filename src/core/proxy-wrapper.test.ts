import { describe, expect, it, vi } from 'vitest';
import { createProxyWrapper } from './proxy-wrapper.js';
import { SubscriptionManager } from './subscription-manager.js';

describe('ProxyWrapper', () => {
  function setup() {
    const subManager = new SubscriptionManager();
    const wrapper = createProxyWrapper(subManager);
    return { subManager, wrapper };
  }

  describe('wrap', () => {
    it('returns a Proxy for a plain object', () => {
      const { wrapper } = setup();
      const target = { a: 1 };
      const proxied = wrapper.wrap(target, 'Root');

      expect(proxied).not.toBeNull();
      expect(proxied).not.toBe(target); // proxy !== target
    });

    it('returns null for a frozen object', () => {
      const { wrapper } = setup();
      const frozen = Object.freeze({ a: 1 });
      expect(wrapper.wrap(frozen, 'Root')).toBeNull();
    });

    it('returns null for a sealed object', () => {
      const { wrapper } = setup();
      const sealed = Object.seal({ a: 1 });
      expect(wrapper.wrap(sealed, 'Root')).toBeNull();
    });

    it('returns null for null', () => {
      const { wrapper } = setup();
      expect(wrapper.wrap(null as unknown as object, 'Root')).toBeNull();
    });

    it('returns null for primitives', () => {
      const { wrapper } = setup();
      expect(wrapper.wrap(42 as unknown as object, 'Root')).toBeNull();
    });

    it('returns cached proxy for same target (WeakMap dedup)', () => {
      const { wrapper } = setup();
      const target = { a: 1 };

      const p1 = wrapper.wrap(target, 'Root');
      const p2 = wrapper.wrap(target, 'Root');
      expect(p1).toBe(p2);
    });
  });

  describe('set trap', () => {
    it('notifies SubscriptionManager on property assignment', async () => {
      const { subManager, wrapper } = setup();
      const cb = vi.fn();
      subManager.subscribe('Root.checkout', cb);

      const proxied = wrapper.wrap({}, 'Root') as Record<string, unknown>;
      proxied.checkout = { ready: true };

      await Promise.resolve();
      expect(cb).toHaveBeenCalledWith({ ready: true });
    });

    it('allows the assignment to succeed (value is stored)', () => {
      const { wrapper } = setup();
      const target: Record<string, unknown> = {};
      const proxied = wrapper.wrap(target, 'Root') as Record<string, unknown>;

      proxied.foo = 'bar';
      expect(target.foo).toBe('bar');
    });

    it('ignores Symbol keys — no notification', async () => {
      const { subManager, wrapper } = setup();
      const sym = Symbol('test');
      const cb = vi.fn();
      subManager.subscribe(`Root.${String(sym)}`, cb);

      const proxied = wrapper.wrap({}, 'Root') as Record<symbol, unknown>;
      proxied[sym] = 'val';

      await Promise.resolve();
      expect(cb).not.toHaveBeenCalled();
    });

    it('does not double-notify (set trap passes target, not receiver)', async () => {
      const { subManager, wrapper } = setup();
      const cb = vi.fn();
      subManager.subscribe('Root.newProp', cb);

      const proxied = wrapper.wrap({}, 'Root') as Record<string, unknown>;
      proxied.newProp = 'value';

      // Flush microtask
      await Promise.resolve();
      expect(cb).toHaveBeenCalledTimes(1);
    });
  });

  describe('defineProperty trap', () => {
    it('notifies when Object.defineProperty is used with a value descriptor', async () => {
      const { subManager, wrapper } = setup();
      const cb = vi.fn();
      subManager.subscribe('Root.defined', cb);

      const proxied = wrapper.wrap({}, 'Root')!;
      Object.defineProperty(proxied, 'defined', {
        value: 'sdk-value',
        writable: true,
        configurable: true,
      });

      await Promise.resolve();
      expect(cb).toHaveBeenCalledWith('sdk-value');
    });

    it('does not notify for accessor descriptors (no value)', async () => {
      const { subManager, wrapper } = setup();
      const cb = vi.fn();
      subManager.subscribe('Root.accessor', cb);

      const proxied = wrapper.wrap({}, 'Root')!;
      Object.defineProperty(proxied, 'accessor', {
        get() { return 42; },
        configurable: true,
      });

      await Promise.resolve();
      expect(cb).not.toHaveBeenCalled();
    });

    it('ignores Symbol keys in defineProperty trap', async () => {
      const { subManager, wrapper } = setup();
      const cb = vi.fn();
      // No way to subscribe to symbol paths, but ensure no error
      subManager.subscribe('Root.sym', cb);

      const proxied = wrapper.wrap({}, 'Root')!;
      const sym = Symbol('test');
      Object.defineProperty(proxied, sym, {
        value: 'sym-val',
        configurable: true,
      });

      await Promise.resolve();
      expect(cb).not.toHaveBeenCalled();
    });
  });

  describe('get trap (lazy nesting)', () => {
    it('returns nested proxy when deep subscribers exist', () => {
      const { subManager, wrapper } = setup();
      // Subscribe to a path deeper than "Root.child"
      subManager.subscribe('Root.child.deep', vi.fn());

      const target = { child: { deep: 'val' } };
      const proxied = wrapper.wrap(target, 'Root') as typeof target;

      const child = proxied.child;
      // Should be a proxy (not the raw object)
      expect(child).not.toBe(target.child);
    });

    it('returns raw value when no deep subscribers exist', () => {
      const { subManager, wrapper } = setup();
      // Only subscribe to "Root.child" (not deeper)
      subManager.subscribe('Root.child', vi.fn());

      const target = { child: { x: 1 } };
      const proxied = wrapper.wrap(target, 'Root') as typeof target;

      // No deep subscribers for "Root.child" → return raw
      expect(proxied.child).toBe(target.child);
    });

    it('returns raw value for primitives regardless of subscribers', () => {
      const { subManager, wrapper } = setup();
      subManager.subscribe('Root.num.deeper', vi.fn());

      const target = { num: 42 };
      const proxied = wrapper.wrap(target, 'Root') as typeof target;
      expect(proxied.num).toBe(42);
    });

    it('returns raw value for null regardless of subscribers', () => {
      const { subManager, wrapper } = setup();
      subManager.subscribe('Root.nil.deeper', vi.fn());

      const target: Record<string, unknown> = { nil: null };
      const proxied = wrapper.wrap(target, 'Root') as typeof target;
      expect(proxied.nil).toBeNull();
    });

    it('deduplicates nested proxies via WeakMap (circular ref safety)', () => {
      const { subManager, wrapper } = setup();
      subManager.subscribe('Root.self.self.deep', vi.fn());

      const target: Record<string, unknown> = {};
      target.self = target; // circular

      const proxied = wrapper.wrap(target, 'Root') as typeof target;
      const nested1 = (proxied as Record<string, unknown>).self;
      // Accessing .self again should return the same proxy (dedup)
      const nested2 = (nested1 as Record<string, unknown>).self;
      expect(nested1).toBe(nested2);
    });

    it('does not proxy frozen nested objects — returns raw', () => {
      const { subManager, wrapper } = setup();
      subManager.subscribe('Root.frozen.deep', vi.fn());

      const frozenChild = Object.freeze({ deep: 'val' });
      const target = { frozen: frozenChild };
      const proxied = wrapper.wrap(target, 'Root') as typeof target;

      // Frozen nested object returned as-is
      expect(proxied.frozen).toBe(frozenChild);
    });
  });
});
