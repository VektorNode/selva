---
title: Errors and retries
order: 4
published: true
description: 'The error codes @selvajs/compute can throw, which ones are retried, and what to do about each.'
---

# Errors and retries

Every failure is a `ComputeError`. Check its `code` (one of `ErrorCodes`), never its message. It also has `statusCode`, `context` (such as `requestId`) and `originalError`.

```ts
import { ComputeError, ErrorCodes } from '@selvajs/compute/core';

try {
	await client.solve(definition, inputs);
} catch (err) {
	if (!(err instanceof ComputeError)) throw err;
	switch (err.code) {
		case ErrorCodes.AUTH_ERROR:
			// the API key is wrong or missing
			break;
		case ErrorCodes.COMPUTATION_ERROR:
			// err.context.errors lists the solver errors
			break;
		default:
		// report err.code and err.context.requestId
	}
}
```

## The codes

Retries are off by default. "Retried" shows what retries once you turn them on.

| Code                    | Means                                                      | Retried?                 | What to do                              |
| ----------------------- | ---------------------------------------------------------- | ------------------------ | --------------------------------------- |
| `NETWORK_ERROR`         | No connection, a 502/503/504, or a cut-off response        | Yes                      | Check the server is running             |
| `CORS_ERROR`            | A browser request got no response, usually CORS            | Yes                      | See the package README                  |
| `TIMEOUT_ERROR`         | No answer within `timeoutMs`                               | Yes                      | Raise `timeoutMs`, or `0` for no limit* |
| `RATE_LIMIT`            | HTTP 429                                                   | Yes, after `Retry-After` | Send fewer requests                     |
| `AUTH_ERROR`            | HTTP 401 or 403                                            | No                       | Fix `apiKey` or `authToken`             |
| `NOT_FOUND`             | HTTP 404                                                   | No                       | Check `serverUrl` and server version    |
| `VALIDATION_ERROR`      | HTTP 400 or 413, or an input failed a check before sending | No                       | Fix the request                         |
| `INVALID_RESPONSE`      | A 200 the client can't use, such as a proxy's login page   | No                       | Check proxies in front of Compute       |
| `RESPONSE_TOO_LARGE`    | Answer bigger than `maxResponseBytes`                      | No                       | Raise the limit or return less          |
| `COMPUTATION_ERROR`     | The solver reported errors, or HTTP 500                    | No                       | See [Partial success](#partial-success) |
| `DEFINITION_NOT_CACHED` | The server no longer holds a reused definition             | No                       | Send the full definition                |
| `INVALID_INPUT`         | Empty definition, bad tree path, or data that isn't JSON   |                          | Fix the call                            |
| `INVALID_CONFIG`        | Bad `serverUrl`, unusable number, or a redirecting server  |                          | Use the final `serverUrl`               |
| `INVALID_STATE`         | Used after `dispose()`, or a file download failed part-way |                          | Create a new one, or download again     |
| `BROWSER_ONLY`          | A file download ran outside a browser                      |                          | Use `groupFilesByRoot` and write files  |
| `ENVIRONMENT_ERROR`     | The runtime has neither `Buffer` nor `atob`/`btoa`         |                          | Run on a runtime that has one           |
| `ENCODING_ERROR`        | A string that should be base64 isn't                       |                          | Fix the input                           |
| `MALFORMED_DEFAULT`     | An input's `default` has a shape the parser can't read     |                          | Not thrown: see below                   |
| `UNKNOWN_ERROR`         | Anything else                                              |                          | Report the `requestId`                  |

\* On Node, undici stops waiting for response headers at 300 s whatever `timeoutMs` is, `0` included. The solve fails with `NETWORK_ERROR` while it keeps running on the server. See "Long jobs behind a proxy" in the [package README](https://github.com/VektorNode/selva/blob/main/packages/compute/README.md#long-jobs-behind-a-proxy).

`DEFINITION_NOT_CACHED` means the server evicted the definition, restarted, or sent the call to another child. A scheduler re-uploads the file itself.

`MALFORMED_DEFAULT` never reaches a `catch`. `getIO` drops the bad default and lists the input in `io.parseErrors` with this `code`.

Redirects are rejected so your API key can't be sent elsewhere.

### Scheduler results

| Code                    | Means                                                                    | What to do                             |
| ----------------------- | ------------------------------------------------------------------------ | -------------------------------------- |
| `SUPERSEDED`            | `latest-wins`: a newer call replaced this one                            | Ignore                                 |
| `ABORTED`               | Cancelled by `signal` or `cancelAll()`                                   | Ignore                                 |
| `QUEUE_FULL`            | `maxQueueDepth` calls were already waiting                               | Try later (maps to HTTP 503)           |
| `QUEUE_TIMEOUT`         | Waited longer than `queueWaitMs`                                         | Try later (maps to HTTP 503)           |

Skip `SUPERSEDED` and `ABORTED` before showing an error, as the [live slider](./common-tasks.md#a-live-slider) does.

## Partial success

A definition can succeed for some outputs and fail for others. Compute answers HTTP 500 with the outputs that worked.

- `client.solve` throws `COMPUTATION_ERROR`: good outputs are in `err.context.values`, failures in `err.context.errors`.
- `scheduler.solve` returns the response. Read `errors` yourself.

```ts
import {
	GrasshopperResponseProcessor,
	type GrasshopperComputeResponse
} from '@selvajs/compute/grasshopper';

// err is a ComputeError, as narrowed in the first example
if (err.code === ErrorCodes.COMPUTATION_ERROR && err.context?.values) {
	const partial = { values: err.context.values } as GrasshopperComputeResponse;
	const { values } = new GrasshopperResponseProcessor(partial).getValues();
}
```

## Retries

Turn them on for a client, a scheduler, or one `client.solve` call:

```ts
const client = await GrasshopperClient.create({
	serverUrl,
	retry: { attempts: 2, baseDelayMs: 500, maxDelayMs: 30_000 }
});
```

`attempts` is the number of retries after the first failure. The wait doubles each time, with jitter; `Retry-After` overrides it.

- A retry can run the same solve twice if the connection dropped after the server got the request. It wastes time but gives the same answer.
- `timeoutMs` applies per try: the worst case is `(attempts + 1) × timeoutMs` plus waits. Pass a `signal` for one overall deadline.

## Finding the cause

Each request has a `requestId`, sent as `X-Request-ID` and set on most errors as `err.context.requestId`. Search the server logs for it. The package logs nothing until you call `setLogger(console)` from `/core`; then `debug: true` logs each request's size, duration and retries, never the data.
