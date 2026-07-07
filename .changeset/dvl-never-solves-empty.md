---
'@selvajs/ui': patch
---

A dynamic value list input never dispatches an empty or stale value to solve anymore. The auto-pick fallback had two paths that leaked invalid values into the solve request: a user-cleared selection was honored as empty (but an empty selection is never a valid solve input — there is always at least one option), and the consecutive-auto-pick loop breaker gave up leaving whatever stale value was in place. Every terminal state now resolves to a currently-valid option, so the definition always receives a value it can match.
