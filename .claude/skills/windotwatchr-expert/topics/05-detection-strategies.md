# Detection strategies and coverage

| Strategy | Interception | Snapshot checks | Identity |
|---|---|---|---|
| auto | Configurable root trap and lazy object/function proxies | Enabled by positive pollInterval until disposal | Wrapped where monitored |
| proxy | Root trap and lazy proxies | No detection polling | Wrapped where monitored |
| poll | None | Enabled by positive pollInterval until disposal | Raw descriptors and SDK objects |

Auto and proxy can share a root. Poll and interception registrations conflict in either order and reject the new registration without disturbing existing subscribers. Reserved Window built-ins always use poll and emit a warning.

A shared path schedules at the fastest live polling interval. Each polling member uses its own predicate; the first ready subscriber cannot strand another. Removing the fastest member changes the interval. Disabled polling and proxy-only subscribers do not gain snapshot detection from siblings. Explicit timeout retries are separate and can still check with pollInterval zero.

Root/middle assignments resolve registered descendants. Child writes reconsider ancestor readiness. Successful set, defineProperty and delete observe the actual resulting lookup, including transformed setters and inherited values revealed by deletion. Failed native writes retain native failure behavior. Callable intermediates remain callable. Locked readonly object-valued children return their exact raw value to preserve Proxy invariants and require polls for deeper raw mutation.

Raw references, closure-backed getters, external predicate dependencies, sealed/frozen values and externally replaced/deleted root traps may require enabled snapshots. Pure poll cannot detect an assignment with polling disabled after its initial sample. Root predicates depending on unmonitored deeper objects need polling; watch the relevant leaf for interception.

String dot paths preserve inherited lookup but cannot represent symbol keys or literal dots in property names. Native/internal-slot/private-field methods can fail with proxied receivers; use poll. Different package builds/versions lack negotiated ownership. Background throttling delays timer checks and deadlines.
