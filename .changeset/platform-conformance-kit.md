---
'@selvajs/platform': minor
---

Conformance kit: the outsider in the `ctxIsolation` cases no longer carries `instance_admin`, so an adapter that filters by ctx passes them. New opt-in options tighten the suites without turning existing adapters red, among them `strictDenials` (denials must carry their status code), `nonAdminCtx`, `auditStamps`, `refusesEscalation`, `orgScopedReads`, `segmentPrefix`, `limitClamp` and `disabledSessionWindowMs`; each suite's options type documents its own. `SeedUserFn`, `SeedUserResult` and `DefinitionTestScope` are exported from `./testing`.
