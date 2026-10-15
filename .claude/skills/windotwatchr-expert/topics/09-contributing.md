# Contributing to core and React

Detection and cleanup live in src/core, public adapters in src/index.ts, and the hook in src/react. Core and React share one internal registry. Published code uses browser APIs; Bun and Vite are build tools only.

Follow [CONTRIBUTING.md](../../../../CONTRIBUTING.md) for setup and release commands. Keep behavioral regressions, run types/lint/browser tests, and check the packed core/React entries and declarations. Linux CI covers WebKit and minimum consumers as well as production examples. Test output is sufficient; no release ledger or approval manifest is required.

Preserve successful SDK writes, raw-value cleanup, descriptor ownership and locked-child Proxy invariants. Public correlation labels are not subscription identity. The raw set receiver avoids duplicate notifications but changes derived-object write semantics; use polling for SDK objects used as prototypes.

Imperative callbacks preserve ready occurrences. Hooks represent the latest observed state, so stale queued occurrences must not overwrite newer observations. Publish predicate changes only after React commits. Keep focused tests for readiness, cancellation, unmount, suspended renders and shared subscriptions.

Keep known limitations explicit. Do not expand runtime machinery to promise universal Proxy transparency. Release 0.3.0 corrections use the existing changelog; subsequent user-facing changes use Changesets. Publication is an explicit maintainer action after the package checks pass.
