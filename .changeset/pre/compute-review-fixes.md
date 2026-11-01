---
'@selvajs/compute': major
'@selvajs/solve': major
---

Secrets stay out of errors and logs, cancellation reaches everything that waits, and public types match what the runtime does.

- **Errors no longer carry secrets.** `validateServerUrl` reports only the scheme and host of a rejected URL. A header value `fetch` can't send fails as `INVALID_CONFIG` before any request, without quoting it. `context.responseHeaders` is an allowlist, so `Set-Cookie` is gone. Definition URLs in error context and file URLs in logs lose their query.
- **Logs carry identifiers.** Logs no longer print server bodies, solver messages or rejected defaults.
- **Probes on Node classify correctly.** `probeServer` includes undici's `cause`, so a refused connection stops the `create()` ladder and DNS failures read as `dns`.
- **Cancellation.** Aborting with any reason gives `ABORTED`. `DefinitionRef.load()` receives a signal that fires on abort or at `timeoutMs`, so a hung load frees its scheduler slot, reporting `TIMEOUT_ERROR` at the deadline. `GrasshopperClient.create()` honours `config.signal`; `probeServer` takes a `signal`. `client.dispose()` disposes the schedulers it created.
- **Long solves on Node.** `ComputeConfig.fetch` replaces the global `fetch`, for undici's `headersTimeout`, which `timeoutMs` can't extend.
- **Validation.** `timeoutMs`, `retry.*` and `maxConcurrent` reject `NaN` and other unusable numbers with `INVALID_CONFIG`.
- **Values.** A text output of `"123"`, `"true"` or a long digit string stays a string. `System.Int64`, `System.Single` and `System.Decimal` parse as numbers, and an `Int64` past 2^53 keeps its digits as a string. A tree `Text` default loses its JSON quotes. `TreeBuilder.append` skips `null` rather than sending the text `"null"`. A ValueList default is always a string.
- **A solve always returns `values`,** an empty array when the server sent none.
- **Paths and bodies.** Drive-relative archive names such as `C:evil.txt` are dropped. A `null` response body is `INVALID_RESPONSE`, for `/io` too, which reported `INVALID_INPUT`.
- **`ComputeServerStats`** sends `Content-Type` on POST only and no longer duplicates a caller's lowercase header.

**ESM only.** `@selvajs/compute` and `@selvajs/solve` no longer ship a CommonJS build, so `ComputeError` and the logger have one copy per process and `instanceof` always holds. Import them; on Node 24 a CommonJS project can still `require()` them.

**Removed:** `TreeBuilder.getParamName` and `TreeBuilder.flatten`, `GrasshopperClient.getConfig`, which handed out the API key, and `SolveScheduler.getMaxConcurrent`. Read a tree's values with `TreeBuilder.getTree`.

**Breaking types:** `SolveResult` loses the `superseded` member, which was never produced. `DataItem.id` is optional, as it is on a stock server. `GetValuesOptions.rhino` is the structural `RhinoRuntime`, which a loaded `RhinoModule` satisfies.
