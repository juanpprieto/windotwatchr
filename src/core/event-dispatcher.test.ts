import { describe, expect, it, vi } from 'vitest';
import { dispatchWatcherEvent } from './event-dispatcher.js';

describe('dispatchWatcherEvent', () => {
  it('dispatches a CustomEvent on window', () => {
    const listener = vi.fn();
    window.addEventListener('ww:test', listener);

    dispatchWatcherEvent('ww:test', { foo: 'bar' });

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0]![0] as CustomEvent;
    expect(event).toBeInstanceOf(CustomEvent);
    expect(event.type).toBe('ww:test');

    window.removeEventListener('ww:test', listener);
  });

  it('event detail matches input', () => {
    const listener = vi.fn();
    window.addEventListener('ww:detail', listener);

    dispatchWatcherEvent('ww:detail', { path: 'Stripe', value: 42 });

    const event = listener.mock.calls[0]![0] as CustomEvent;
    expect(event.detail).toEqual({ path: 'Stripe', value: 42 });

    window.removeEventListener('ww:detail', listener);
  });

  it('no-ops when window is undefined (SSR)', () => {
    const original = globalThis.window;
    // @ts-expect-error simulate SSR
    delete globalThis.window;

    expect(() => {
      dispatchWatcherEvent('ww:ssr', { path: 'x' });
    }).not.toThrow();

    globalThis.window = original;
  });
});
