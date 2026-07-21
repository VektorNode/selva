---
'@selvajs/platform': minor
---

Export the structured logging contract from the platform barrel: `ILogger`,
`LogLevel`, `LogFields`, and the `NoopLogger` default (from
`./logging/interface.js`).

These types were added to the platform source with the Pino structured-logging
work (request ID correlation), but that commit carried no `@selvajs/platform`
changeset — so the published `0.15.0-beta.1` tarball (released three days
earlier) predates them entirely. Meanwhile `@selvajs/server@0.2.0-beta.5` was
published importing `NoopLogger` from `@selvajs/platform` with a
`^0.15.0-beta.1` dependency, so any consumer installing server beta.5 from npm
fails at module load with `SyntaxError: The requested module '@selvajs/platform'
does not provide an export named 'NoopLogger'`. This release publishes the
logging interface so server beta.5's existing dependency range resolves a
platform build that actually ships the export — no server republish required.
