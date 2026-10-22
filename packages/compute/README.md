<!-- Badges -->
<div align="center">

[![npm version](https://img.shields.io/npm/v/@selvajs/compute.svg)](https://www.npmjs.com/package/@selvajs/compute)
[![npm downloads](https://img.shields.io/npm/dm/@selvajs/compute.svg)](https://www.npmjs.com/package/@selvajs/compute)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-24+-green.svg)](https://nodejs.org/)
[![GitHub Repository](https://img.shields.io/badge/GitHub-VektorNode/selva-blue?logo=github)](https://github.com/VektorNode/selva)

</div>

# @selvajs/compute

A TypeScript client for Rhino Compute and Grasshopper definitions: typed definition IO, data trees,
and a scheduler that handles cancellation, retries and caching.

Pure solve/data: no rendering layer, no `three` dependency. To turn a solve response into Three.js
objects, use [`@selvajs/visualization`](https://www.npmjs.com/package/@selvajs/visualization).

```bash
npm install @selvajs/compute
```

Two entrypoints: `@selvajs/compute/grasshopper` (client, scheduler, data trees, IO parsing) and
`@selvajs/compute/core` (low-level fetch, errors, config). There is no root entry: import a
subpath.

## Quickstart

`client.solve` sends one request. A scheduler adds cancellation, retries, loading state and an
optional response cache on top; use one for any UI that fires solves.

```ts
import { readFile } from 'node:fs/promises';
import { ErrorCodes } from '@selvajs/compute/core';
import {
	GrasshopperClient,
	TreeBuilder,
	GrasshopperResponseProcessor
} from '@selvajs/compute/grasshopper';

const client = await GrasshopperClient.create({
	serverUrl: 'http://localhost:6500',
	apiKey: 'your-api-key'
});

const scheduler = client.createScheduler({ mode: 'latest-wins', timeoutMs: 30_000 });

// A URL, or the .gh bytes: a bare file name would be sent as the definition text.
const definition = new Uint8Array(await readFile('my-definition.gh'));

const io = await client.getIO(definition);
const inputTree = TreeBuilder.fromInputParams(io.inputs);

const result = await scheduler.solve(definition, inputTree);
const { values } = new GrasshopperResponseProcessor(result).getValues();
```

Wire the scheduler's state into your UI for spinners and disabled buttons:

```ts
scheduler.subscribe(() => {
	showSpinner = scheduler.isSolving;
	disableSubmit = scheduler.hasPending;
});
```

## Configuring the scheduler

Pick the row that matches what the user is doing:

| Workload                          | `mode`          | `timeoutMs`      | `retry`           | Notes                                                                                                                    |
| --------------------------------- | --------------- | ---------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Slider scrubs / live previews** | `'latest-wins'` | `30_000`         | default           | Aborts in-flight solves when newer values arrive. Add `cache: { maxBytes: 64 * 1024 * 1024 }` for instant repeats.       |
| **Submit / long-running jobs**    | `'queue'`       | `0` (no timeout) | `{ attempts: 1 }` | Serial queue. Pass a caller `signal` so users can hit Cancel. See [Long jobs behind a proxy](#long-jobs-behind-a-proxy). |
| **Background / batch parallel**   | `'queue'`       | `60_000`         | `{ attempts: 2 }` | Set `maxConcurrent` (e.g. 4) to run that many solves at once; queue mode defaults to 1.                                  |

Create one scheduler per UI surface: their queues, cancel scopes and caches are independent.

`config.retry` covers solves. The liveness probe `GrasshopperClient.create` runs has its own
ladder: pass `{ probe: { attempts, baseDelayMs, maxDelayMs } }` as its second argument.

`scheduler.solveDetailed()` resolves `{ response, fromCache, definitionReuploaded, durationMs }`
for that one call, and takes a per-call `onServerTiming`. Use it to record how each solve went;
`onSettle` fires for every solve on the scheduler.

Don't mutate a `Uint8Array` definition after solving it. The scheduler hashes a buffer once and
remembers the hash by identity, so a changed buffer is served the old content's cached responses.

### Cancellation

A superseded or cancelled solve rejects. Filter those by code:

```ts
const ctrl = new AbortController();
scheduler.solve(definition, inputTree, { signal: ctrl.signal }).catch((err) => {
	if (err.code === ErrorCodes.SUPERSEDED || err.code === ErrorCodes.ABORTED) return;
	showError(err);
});

ctrl.abort(); // cancel this call
scheduler.cancelAll(); // cancel everything in flight and pending, e.g. on unmount
scheduler.dispose(); // cancel everything and tear the scheduler down
```

### Long jobs behind a proxy

A proxy in front of Compute closes idle connections after its own timeout, and the library can't
work around that: raise the proxy's idle timeout before running long solves from a browser. For
solves longer than a couple of minutes, run this library server-side behind your own job queue
and expose a status endpoint to the browser.

## Errors

Every failure is a `ComputeError`. Branch on `err.code`, one of `ErrorCodes`, not on the message.

`client.solve` and `scheduler.solve` differ on a response that carries Grasshopper `errors`.
`client.solve` throws `COMPUTATION_ERROR`, with the outputs that did compute in
`err.context.values`. `scheduler.solve` resolves with the response, so check it yourself:

```ts
import { readField } from '@selvajs/compute/core';

const response = await scheduler.solve(definition, inputTree);
// Read case-insensitively: stock Rhino Compute sends `Errors`.
const solveErrors = readField<string[]>(response, 'errors');
if (solveErrors?.length) showError(solveErrors.join('\n'));
```

## Data trees

`TreeBuilder.fromInputParams` builds one tree per input from its default, keyed by the input's
**nickname**. `TreeBuilder.fromValues` builds them from your own values instead: it coerces
Number, Integer and Boolean items, clamps numbers to `minimum`/`maximum`, and drops what it can't
coerce, so Grasshopper keeps its own value for that input. `replaceTreeValue` is copy-on-write: it
returns a new array and leaves yours untouched, so assign the result or the solve sends the
defaults.

```ts
let inputTree = TreeBuilder.fromInputParams(io.inputs);
inputTree = TreeBuilder.replaceTreeValue(inputTree, 'Radius', 10);
inputTree = TreeBuilder.replaceTreeValue(inputTree, 'Counts', { '{0}': [1, 2], '{0;1}': [3] });
```

Read outputs through `GrasshopperResponseProcessor`, or a whole tree with
`TreeBuilder.getTree(response.values, 'Points')`: a `Map` from branch path (`'{0;1}'`) to items.
`getTreeValue` is the shortcut for a one-branch param: it unwraps a single item and throws when
the param has more than one branch.

Pass a rhino3dm module as `{ rhino }` in the `getValues` / `getValue` options to decode geometry. Its objects live on the WASM
heap, which garbage collection never frees: release them with `disposeRhinoObjects`. Install
`rhino3dm` yourself; this package doesn't depend on it.

## File outputs

File outputs need the [Selva plugin](https://www.food4rhino.com/en/app/selva?lang=en) and the
[VektorNode compute fork](https://github.com/VektorNode/compute.rhino3d); standard Rhino Compute
drops them. Read one with `getValue` and it comes back as `FileData`.

Each file component has a `Sub Folder` input, where `::` nests (as in Rhino layer names). The
first segment is the root: `downloadFileDataByRoot` from `/core` turns each root into its own
archive and puts files without one in the fallback archive. With `'export'` as the fallback name:

| `Sub Folder`          | Archive      | Path in the archive      |
| --------------------- | ------------ | ------------------------ |
| _(empty)_             | `export.zip` | `model.3dm`              |
| `Panels`              | `Panels.zip` | `model.3dm`              |
| `ROOT::Panels`        | `ROOT.zip`   | `Panels/model.3dm`       |
| `ROOT::First::Second` | `ROOT.zip`   | `First/Second/model.3dm` |

`groupFilesByRoot` returns the same grouping without the DOM, for writing files in Node.
`processor.getAndDownloadFiles(name)` skips the split: one `name.zip`, each file at its full
`Sub Folder` path.

## Requirements

**Node.js >= 24.**

The [official McNeel Rhino Compute](https://github.com/mcneel/compute.rhino3d) handles plain
Grasshopper solving. The [VektorNode compute fork](https://github.com/VektorNode/compute.rhino3d)
adds input grouping (`groupName`), persistent input ids keyed on Grasshopper object GUIDs, file
export, and block instance support. The
[Selva Rhino plugin](https://www.food4rhino.com/en/app/selva?lang=en) supplies the Display and
file-export components those features read.

## Troubleshooting

**`Network error: Failed to fetch`** means the browser couldn't reach the server. Check that
`curl http://localhost:6500/` returns 200; that a server on another origin sends
`Access-Control-Allow-Origin` (standard Rhino Compute doesn't: put a proxy in front that adds it,
or use the [VektorNode fork](https://github.com/VektorNode/compute.rhino3d)); that an HTTPS app
isn't calling an HTTP server; and that the API key is set, since a 401 without CORS headers reads
as a network error too.

**401** means `apiKey` (the `RhinoComputeKey` header) is missing or wrong. **403** usually comes
from a proxy or API gateway rejecting `authToken`, which is sent verbatim as the `Authorization`
header, so include the scheme (`Bearer …`). The error message carries an excerpt of the response
body.

## Acknowledgement

**Key references:**

- [compute.rhino3d.appserver](https://github.com/mcneel/compute.rhino3d.appserver) – Server implementation reference
- [IO/Schema.cs](https://github.com/mcneel/compute.rhino3d/blob/8.x/src/compute.geometry/IO/Schema.cs) – Grasshopper API structure
- [GrasshopperDefinition.cs](https://github.com/mcneel/compute.rhino3d/blob/8.x/src/compute.geometry/GrasshopperDefinition.cs) – Definition parsing logic
- [computeclient_js](https://github.com/mcneel/computeclient_js) – JavaScript client implementation

## License

MIT
