/**
 * Resolve a dot-notation path against an object.
 *
 * Walks each segment of the path, returning `undefined` if any
 * intermediate segment is nullish.
 *
 * @param root - The root object to start from (typically `window`).
 * @param path - Dot-notation path (e.g., `"Stripe.checkout.sessions"`).
 * @returns The value at the path, or `undefined` if any segment is missing.
 *
 * @example
 * ```ts
 * const obj = { a: { b: { c: 42 } } };
 * resolvePath(obj, 'a.b.c');   // 42
 * resolvePath(obj, 'a.b.d');   // undefined
 * resolvePath(obj, 'a.x.c');   // undefined
 * ```
 */
export function resolvePath(root: object, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = root;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}
