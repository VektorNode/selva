# `server/` — the solve engine behind the wire

This folder takes the definition bytes, the input values, and a ready scheduler, runs the solve,
and returns something the transport can send back.

```text
build input tree -> scheduler.solve -> serialize -> gzip -> Server-Timing
```

`runSolvePipeline` returns a `SolveOutcome`. `ok` carries the response, and the other cases name
expected failures like timeout, client abort, too large, backpressure, or compute errors. Expected
failures do not throw. The route decides how they become HTTP responses.

## What is in here

| File                           | What it does                                            |
| ------------------------------ | ------------------------------------------------------- |
| `solve-pipeline.ts`            | Runs the full solve pipeline                            |
| `transform-input.ts`           | Turns one schema input and one value into an input tree |
| `client-cache.ts`              | Keeps a warm Compute client and scheduler               |
| `definition-byte-cache.ts`     | Caches `.gh` bytes by version                           |
| `solve-cache-single-flight.ts` | Shares one solve when many requests are identical       |

## Real-world flow

This is what happens when a request comes in:

1. The server builds the input tree.
2. The scheduler solves the definition.
3. The result is serialized and size-checked.
4. The body is gzipped.
5. Timing headers are added for the client.

## Example route

This is the shape a route usually has:

```ts
import { runSolvePipeline } from '@selvajs/solve/server';

export async function POST(request: Request): Promise<Response> {
	const body = await request.json();
	const outcome = await runSolvePipeline({
		definitionSource: body.definitionSource,
		inputs: body.inputs,
		values: body.values,
		client,
		responseMaxBytes: 10 * 1024 * 1024,
		solveDeadlineMs: 30_000,
		acceptEncoding: request.headers.get('accept-encoding') ?? '',
		signal: request.signal,
		loadStartMs: performance.now(),
		defLoadMs: 0
	});

	if (outcome.kind === 'ok') {
		return new Response(outcome.envelope.body, { headers: outcome.envelope.headers });
	}

	if (outcome.kind === 'timeout') return new Response(outcome.message, { status: 504 });
	if (outcome.kind === 'client_abort') return new Response(null, { status: 499 });
	if (outcome.kind === 'too_large') return new Response('Response too large', { status: 413 });
	if (outcome.kind === 'shed') {
		return new Response(outcome.message, {
			status: 503,
			headers: { 'Retry-After': String(outcome.retryAfterSeconds) }
		});
	}

	return new Response('Solve failed', { status: 500 });
}
```

The important part is that the route decides HTTP status codes, while the pipeline decides what the
solve result means.

## Node only

This code reads `node:zlib`, `node:crypto`, and `process.env`. It must never be reachable from
`client/`.

The boundary is enforced in three places:

1. There is no root export.
2. `src/client/**` may not import `../server/*`, `@selvajs/platform`, `@selvajs/server*`, or
   `node:*`.
3. A bundle test checks the shipped client build.

Anything both halves need goes in `shared/`.

## Cache layers

There are two caches, and they do different jobs:

| Where                        | What it keys on                          | Scope           |
| ---------------------------- | ---------------------------------------- | --------------- |
| `client/solve-memo.ts`       | the raw input values                     | one browser tab |
| `@selvajs/compute` scheduler | the definition plus the transformed tree | one process     |

There is no durable cache here today. The old in-memory cache was removed because it duplicated
the scheduler cache. If the app ever needs shared storage, the `ISolveResultCache` seam in
`@selvajs/platform` is where that would plug in.

Two requests that produce the same transformed tree share one solve.

## Server-Timing

`COMPUTE_CONTRACT_VERSION` and `COMPUTE_VERSION_HEADER` version the response shape. Bump them when
the body or phases change in a way a client could notice.

## Relationship to `@selvajs/server/compute`

That subpath owns request policy only: rate limiting, SSRF guard, env-derived limits, and the
remote-definition fetcher. It does not depend on `@selvajs/solve`.
