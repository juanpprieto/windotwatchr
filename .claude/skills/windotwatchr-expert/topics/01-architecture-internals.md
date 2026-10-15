# Architecture and internals

The public core entry exports watchWindot and waitForWindot. The React entry exports useWatchWindot. The package is ESM-only: both entries import one shared internal chunk with registry, weak proxy identity metadata and ID sequence. There is no global symbol registry or cross-format protocol. Different package copies do not negotiate ownership.

Each root owns its trap, wrapper, per-path polls and active disposers, including registrations still being installed. A subscription independently owns its predicate, snapshot readiness/value, detection-error episode and disposed state. Public correlation labels are not internal identity.

Configurable root accessors retain raw data separately from wrappers and preserve original setters and attributes. Nested wrappers support objects and functions, use one proxy per raw object, and route observed aliases against current SDK identities. Failed native mutations do not notify. Successful mutations observe the resulting lookup; getter/predicate failures are isolated from SDK writes.

Assignments represent distinct observable occurrences. Polls sample current state and suppress equal ready snapshots. A not-ready-to-ready transition permits another snapshot delivery. No mechanism reconstructs raw mutations entirely between samples.

Delivery runs in a microtask. Readiness/disposal are checked before the ready event and again after its synchronous listeners. Callback errors cannot suppress healthy subscriptions; once cleanup executes in finally.

Last disposal restores the raw root only while the installed descriptor is still owned and configurable. Locked installed accessors cannot be removed; disposed accessors return raw data. External replacements survive cleanup. Previously handed-out proxies cannot be revoked.
