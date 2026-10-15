import { describe, expect, it } from "vitest";
import { resolvePath } from "./resolve-path.js";

describe('resolvePath', () => {
  it('resolves a single-level path', () => {
    expect(resolvePath({ a: 1 }, 'a')).toBe(1);
  });

  it('resolves a multi-level path', () => {
    expect(resolvePath({ a: { b: { c: 42 } } }, 'a.b.c')).toBe(42);
  });

  it('returns undefined for a missing intermediate segment', () => {
    expect(resolvePath({ a: { b: 1 } }, 'a.x.c')).toBeUndefined();
  });

  it('returns undefined for a missing leaf segment', () => {
    expect(resolvePath({ a: { b: 1 } }, 'a.b.c')).toBeUndefined();
  });

  it('returns undefined when root is null', () => {
    expect(resolvePath({ a: null } as object, 'a.b')).toBeUndefined();
  });

  it('handles empty string segments in path', () => {
    // Edge case: "a..b" splits to ["a", "", "b"]
    expect(resolvePath({ a: { '': { b: 1 } } }, 'a..b')).toBe(1);
  });
});
