# Contributing to core and React

Work in src/core for detection/lifetime logic, src/index.ts for public adapters, src/react for hook behavior and vite.config.ts for ESM library packaging. One shared internal module owns the registry and weak identity metadata. Bun scripts use native file/process/hash APIs; directory operations use standard fs APIs. Published browser code has no tooling-runtime imports.

Describe behavior explicitly in comments and test names; task codes belong in internal plans/ledgers. Document exported functions with parameters, returns and useful examples. Keep comments aligned with executable behavior and avoid phase labels.

Use mise install and bun install --frozen-lockfile. Run bun check, bun build and bun test:consumers. Consumer checks pack the actual package, extract outside the workspace, compile strict ESM declarations and using syntax, and run real-browser core/React registration/disposal/reassignment/conflict cases. Vitest's default browser suite covers Chromium/Firefox; bun test:all adds WebKit and is mandatory in Linux CI. Package version and integrity identify what was tested; a development candidate is not final release approval.

Keep native mutation semantics: Reflect.set uses the raw target receiver to avoid implicit defineProperty double notifications while preserving inherited setter lookup. Only successful mutations notify; observe actual resulting values. Preserve locked-child Proxy invariants and root descriptor ownership. Public labels never define subscription identity.

Regression tests should preserve the actual hostile scenario: late middle assignment, enabled frozen/closure polling, non-configurable roots, SDK getter/predicate failures, assignment then unmount before microtask, and reentrant event listeners. Use fake timers for exact resource assertions and real built consumers/browsers for acceptance. resetRegistry releases all registrations including timers/listeners; clean test roots separately.

Both example production builds and browser tests are release requirements. Minimum Node/React/types/compiler environments require their own evidence. A green unit suite does not establish support floors, background-throttling behavior, deployed demos or npm publication.

Final release preparation must version/build/pack before independent approval. Approval identifies the final source commit and tarball digest, and content changes invalidate it. Publishing is a separately authorized step; never treat a source-only review or an unchecked roadmap as release approval.
