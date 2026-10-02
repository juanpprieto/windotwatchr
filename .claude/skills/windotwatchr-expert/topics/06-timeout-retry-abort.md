# Timeout, retries, abort and disposal

Persistent callbacks keep detection after success and after timeout/retry exhaustion. Success clears completed deadline/retry work; abort or explicit disposal ends their lifetime. Once callbacks clean up after the first delivery, even on throw or reentrant assignment.

A promise settles once: readiness resolves it; final timeout rejects; abort rejects with signal.reason exactly, including null, false, zero, strings and objects. Already-aborted signals allocate no detection. Signals without reason use AbortError. Terminal promise paths remove all wait-owned timers, subscriptions and signal listeners.

Timeout emits attempt zero at the initial deadline. Extra retry checks run at positive pollInterval, or 100 ms if detection polling is disabled. A retry samples and gives ready delivery a microtask opportunity before reporting failure. Timeout/retries do not cancel a persistent callback watcher or mounted hook; late readiness can still succeed.

TimeoutError and fallback AbortError are DOMExceptions when available, otherwise Errors with matching names. Manual cancellable timers/listeners supply composition and cleanup without requiring AbortSignal.timeout or AbortSignal.any. This deliberately departs from native active-time semantics. Throttled/suspended pages may report deadlines late.

Delays must be finite and within zero to 2,147,483,647 ms; fractions round up, zero disables. Retry counts must be integers in that range. Validation occurs before resources. Runtime setup errors roll back acquired resources without harming sibling registrations.

Using scopes dispose at scope exit, which can be before readiness. Keep an async scope open by awaiting readiness, as in README. Using needs runtime Symbol.dispose or a prior polyfill; direct disposer calls do not. Once and using have different lifetime triggers.
