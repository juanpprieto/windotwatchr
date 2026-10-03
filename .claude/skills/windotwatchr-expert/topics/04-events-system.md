# Lifecycle events

CustomEvents dispatch on window and are typed through WindowEventMap.

| Event | Detail | Scope and timing |
|---|---|---|
| ww:ready | path, value, id | Per subscription candidate, immediately before its callback. A listener can dispose or invalidate readiness and suppress the following callback. |
| ww:timeout | path, attempts, elapsed, id | Per subscription, initial deadline then failed retries. Attempts starts at zero; elapsed is the configured initial timeout, not cumulative wall time. |
| ww:error | path, error, id? | Per callback failure; first getter/predicate failure in each subscription's consecutive detection-error episode. |
| ww:warning | path, reason | Root-wide interception diagnostic, without a subscription ID. |

Two subscriptions can produce two ready events for one write. This changes global-listener cardinality from 0.2.0. Treat correlationId as a label supplied by the caller, not a guaranteed unique identity. Core and React entries from the same installed ESM package share an ID sequence. Different package copies do not share ownership. Hook isolation uses private registration callbacks.

Repeated detection failures, even with changed thrown values, produce one error per consecutive episode. A successful getter/predicate check resets the episode. Newly affected subscribers get their own error. Callback exceptions report independently for each callback occurrence. Disposal stops future detection errors.

Warnings cover frozen/sealed root values, failed root interception and reserved built-ins. They do not prove or exhaust coverage of every unsupported nested shape. Warning absence is not a readiness guarantee.
