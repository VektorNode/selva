<!-- Badges -->
<div align="center">

[![npm version](https://img.shields.io/npm/v/@selvajs/compute.svg)](https://www.npmjs.com/package/@selvajs/compute)
[![npm downloads](https://img.shields.io/npm/dm/@selvajs/compute.svg)](https://www.npmjs.com/package/@selvajs/compute)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9+-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-24+-green.svg)](https://nodejs.org/)
[![GitHub Repository](https://img.shields.io/badge/GitHub-VektorNode/selva-blue?logo=github)](https://github.com/VektorNode/selva)

</div>

# @selvajs/compute

A TypeScript client for Rhino Compute and Grasshopper definitions: typed definition IO, data trees,
and a scheduler that handles cancellation, retries and caching.

Pure solve/data — no rendering layer, no `three` dependency. To turn a solve response into Three.js
objects, use [`@selvajs/visualization`](https://www.npmjs.com/package/@selvajs/visualization).

```bash
npm install @selvajs/compute
```

Three entrypoints: `@selvajs/compute/grasshopper` (client, data trees, IO parsing),
`@selvajs/compute/core` (low-level fetch, errors, config). The root is empty on purpose — import a
subpath.

> **This is not a job queue.** For solves longer than a couple of minutes, run this library
> server-side behind your own queue (BullMQ / SQS / Cloud Tasks) and expose a status endpoint to
> the browser.

## Quickstart

Every solve in `@selvajs/compute` goes through a **scheduler**. The scheduler
handles cancellation, retries, loading state, and (optionally) a response cache
— things every real app needs and shouldn't have to rebuild.

```ts
import {
	GrasshopperClient,
	TreeBuilder,
	GrasshopperResponseProcessor
} from '@selvajs/compute/grasshopper';

const client = await GrasshopperClient.create({
	serverUrl: 'http://localhost:6500',
	apiKey: 'your-api-key'
});

// Configure the scheduler for your workload (see "Configuring the scheduler" below).
const scheduler = client.createScheduler({ mode: 'latest-wins', timeoutMs: 30_000 });

// Inspect the definition's inputs once, build a data tree.
const io = await client.getIO('my-definition.gh');
const inputTree = TreeBuilder.fromInputParams(io.inputs);

// Solve. Returns a Promise — call it as often as you like.
const result = await scheduler.solve('my-definition.gh', inputTree);
const { values } = new GrasshopperResponseProcessor(result).getValues();
```

Wire the scheduler's state into your UI for spinners and disabled buttons:

```ts
scheduler.subscribe(() => {
	showSpinner = scheduler.isSolving;
	disableSubmit = scheduler.hasPending;
});
```

And handle expected cancellations gracefully — when newer values supersede an
in-flight solve, or when the user aborts:

```ts
scheduler.solve(definition, inputTree).catch((err) => {
	if (/superseded|aborted/i.test(err.message)) return; // expected, not an error
	showError(err);
});
```

## Configuring the scheduler

The scheduler is one API with two knobs that matter — `mode` and `timeoutMs` —
plus a couple of optional ones. Pick the row that matches what the user is
doing in your UI:

| Workload                          | `mode`          | `timeoutMs`      | `retry`           | Notes                                                                                                 |
| --------------------------------- | --------------- | ---------------- | ----------------- | ----------------------------------------------------------------------------------------------------- |
| **Slider scrubs / live previews** | `'latest-wins'` | `30_000`         | default           | Aborts in-flight solves when newer values arrive. Add `cache: { ttlMs: 60_000 }` for instant repeats. |
| **Submit / long-running jobs**    | `'queue'`       | `0` (no timeout) | `{ attempts: 1 }` | Serial queue. Pass a caller `signal` so users can hit Cancel. Bump proxy idle timeouts (see below).   |
| **Background / batch parallel**   | `'parallel'`    | `60_000`         | `{ attempts: 2 }` | Fires solves concurrently up to `maxConcurrent` (default 4).                                          |

You can create multiple schedulers from one client — typically one per UI
surface. They share the connection pool but their queues, cancel scopes, and
caches are independent:

```ts
const previewScheduler = client.createScheduler({ mode: 'latest-wins', timeoutMs: 30_000 });
const submitScheduler = client.createScheduler({
	mode: 'queue',
	timeoutMs: 0,
	retry: { attempts: 1 }
});
```

### Cancellation

Pass a per-call `signal` to cancel just that solve, or call `cancelAll()` to
cancel everything (e.g. on route change or component unmount):

```ts
const ctrl = new AbortController();
scheduler.solve(definition, tree, { signal: ctrl.signal });

// Later:
ctrl.abort(); // cancel just this call
scheduler.cancelAll(); // cancel everything in flight + pending
scheduler.dispose(); // cancel everything and tear down the scheduler
```

### Long jobs behind a proxy

Cloudflare's default idle timeout is 100s; AWS ALB's is 60s; nginx is 60s.
If your Compute server is behind any of them, those values must be bumped
before you can run long solves through the browser — the library cannot work
around proxy timeouts.

For solves longer than ~2 minutes, the safer architecture is to run this
library **server-side** behind your own job queue (BullMQ / SQS / Cloud Tasks)
and expose a status endpoint to the browser.

## Requirements

**Node.js >= 24.**

The [official McNeel Rhino Compute](https://github.com/mcneel/compute.rhino3d) handles plain
Grasshopper solving. Some features need more:

- The [VektorNode compute fork](https://github.com/VektorNode/compute.rhino3d) adds input grouping
  (`groupName`), persistent input ids keyed on Grasshopper object GUIDs, file export, and block
  instance support.
- The [Selva Rhino plugin](https://www.food4rhino.com/en/app/selva?lang=en) supplies the Display
  and file-export components those features read.

Anything requiring either is marked where it's documented.

## Troubleshooting

### `Network error: Failed to fetch`

The browser couldn't reach the server. Check, in order:

1. **Server is running** — `curl http://localhost:6500/healthcheck` should return
   a 200.
2. **CORS** — if your Compute server is on a different origin than your app,
   the server must send `Access-Control-Allow-Origin`. Standard Rhino Compute
   does **not** ship with CORS enabled; you'll need to put it behind a proxy
   that adds the headers, or use the [VektorNode custom branch](https://github.com/VektorNode/compute.rhino3d).
3. **Mixed content** — an HTTPS app can't fetch from an HTTP server. Either
   serve Compute over HTTPS or develop locally on HTTP.
4. **API key** — you'll see the same error if your `apiKey` is missing for a
   server that requires one (the server typically returns 401 with no CORS
   headers, which the browser surfaces as a network error).

### Solves timing out before the server finishes (502 / 504 / aborted)

A proxy in front of Compute, not the library — see [Long jobs behind a
proxy](#long-jobs-behind-a-proxy).

### `Definition URL/content is required`

You called `client.solve('', tree)` or passed a `Uint8Array` of length 0.
Validate your input before calling.

### 401 vs 403

- **401 Unauthorized** — `apiKey` (`RhinoComputeKey` header) is missing or
  invalid. Standard Rhino Compute uses this scheme.
- **403 Forbidden** — your `authToken` (Bearer) was rejected by an upstream
  proxy/API gateway. The Compute server itself almost never returns 403.

The error message includes the response body excerpt so you usually get a hint
from the server itself.

### "Superseded by newer solve" errors flooding my console

The scheduler doing its job in `latest-wins` mode — every aborted slider solve rejects with this
message. Filter it as shown in the [Quickstart](#quickstart).

## Acknowledgement

Where code is adapted from McNeel's repositories, it is marked in the relevant files.

**Key references:**

- [compute.rhino3d.appserver](https://github.com/mcneel/compute.rhino3d.appserver) – Server implementation reference
- [IO/Schema.cs](https://github.com/mcneel/compute.rhino3d/blob/8.x/src/compute.geometry/IO/Schema.cs) – Grasshopper API structure
- [GrasshopperDefinition.cs](https://github.com/mcneel/compute.rhino3d/blob/8.x/src/compute.geometry/GrasshopperDefinition.cs) – Definition parsing logic
- [computeclient_js](https://github.com/mcneel/computeclient_js) – JavaScript client implementation

## License

MIT
