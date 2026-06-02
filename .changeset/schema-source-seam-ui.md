---
'@selvajs/ui': minor
---

Surface the Solve Session API and fix the `onLoadValues` callback contract.

**New public exports.** `createSolveSession`, `createRequestResponseDriver`, and the
`SolveSession` / `SolveSessionArgs` / `SolveDriver` / `SolveReporter` types are now exported
from the package root. This lets transports outside the package (e.g. a WebSocket driver)
satisfy `SolveDriver` and drive a session. See `CONTEXT.md` for the vocabulary.

**Fix — `AppLayout` `onLoadValues` forwards the loaded values.** Previously the callback
fired with no argument (and its type was `() => void`), so a host subscribing to a preset
load received `undefined`. The signature is now
`onLoadValues?: (values: Record<string, unknown>) => void | Promise<void>` and the loaded
values are passed through. Additive for callers that ignore the argument.
