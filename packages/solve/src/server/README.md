# `server/` — the solve engine behind the wire

This folder takes the definition, the input values, and a ready scheduler, runs the solve, and
returns something the transport can send back.

```text
build input tree -> single-flight( scheduler.solve ) -> serialize -> gzip -> Server-Timing
```

`SolveEngine.solve` returns a `SolveEngineOutcome`. `ok` carries the response, and the other cases
name expected failures like timeout, client abort, too large, backpressure, or compute errors.
Expected failures do not throw. A caller's mistake, such as a raw definition without a
`definitionKey`, does.

## What is in here

| File                           | What it does                                                      |
| ------------------------------ | ----------------------------------------------------------------- |
| `solve-engine.ts`              | The public facade: caches, coalescing, one call per solve         |
| `solve-pipeline.ts`            | Runs one solve and classifies how it ended                        |
| `response-encoding.ts`         | Turns a response into each caller's wire form                     |
| `server-timing.ts`             | Builds the `Server-Timing` header                                 |
| `transform-input.ts`           | Builds the solve's input tree from schema inputs and their values |
| `client-cache.ts`              | Keeps a warm Compute client and scheduler                         |
| `concurrency-probe.ts`         | Tracks how many children a Compute server has                     |
| `long-fetch.ts`                | Lifts undici's timeouts for deadlines past 300 s                  |
| `definition-byte-cache.ts`     | Caches `.gh` bytes by version                                     |
| `solve-cache-single-flight.ts` | Shares one solve when many requests are identical                 |

## Real-world flow

This is what happens when a request comes in:

1. The engine gets the warm client and builds the input tree.
2. Single-flight joins an identical solve or starts one. Only the solve is shared.
3. The scheduler solves the definition.
4. Each caller gets the result serialized, size-checked and gzipped for its own `Accept-Encoding`,
   with its own timing. The JSON is built once per flight, the gzip once per response.

A flight aborts when its last caller leaves, and frees its key then.

## Example route

```ts
import { solveInputsFromSchema } from '@selvajs/solve/server';

export async function POST(request: Request): Promise<Response> {
	const body = await request.json();
	const outcome = await engine.solve({
		server,
		definitionSource: engine.definitionRef(version.id, (signal) => storage.get(version.fileKey)),
		inputs: solveInputsFromSchema(version.schema),
		values: body.values,
		acceptEncoding: request.headers.get('accept-encoding') ?? '',
		signal: request.signal
	});
	return engine.toWebResponse(outcome);
}
```

`toWebResponse` throws a `compute_error`'s error, so the route's own handler decides what a failed
Compute means to its caller.

## Node only

This code uses `node:zlib`, `node:util` and `undici`. It must never be reachable from `client/`.

The boundary is enforced in four places:

1. There is no root export.
2. `src/client/**` and `src/shared/**` may not import `../server/*`, `@selvajs/platform`,
   `@selvajs/server*`, `undici` or `node:*`.
3. `tsconfig.client.json` compiles those folders without Node's types.
4. A bundle test checks the shipped client build.

Anything both halves need goes in `shared/`.

## Cache layers

There are two caches, and they do different jobs:

| Where                        | What it keys on                          | Scope           |
| ---------------------------- | ---------------------------------------- | --------------- |
| `client/solve-memo.ts`       | the raw input values                     | one browser tab |
| `@selvajs/compute` scheduler | the definition plus the transformed tree | one process     |

There is no durable cache here today.

Two requests that produce the same transformed tree share one solve.

## Evicting a server

`evictServer(id)` drains: solves already running finish on the old connection details, then the
client is disposed. A revoked key therefore stays in use until they end, at most one solve deadline.
A build in flight is abandoned, and its caller gets a retryable `shed` with reason `interrupted`.

## Contract version

`COMPUTE_CONTRACT_VERSION` and `COMPUTE_VERSION_HEADER` version the response shape. Bump them when
the body or phases change in a way a client could notice.

## Relationship to `@selvajs/server/compute`

That subpath owns request policy only: rate limiting, SSRF guard, env-derived limits, and the
remote-definition fetcher. It does not depend on `@selvajs/solve`.
