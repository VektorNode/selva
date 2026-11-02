---
title: Errors and retries
order: 3
published: true
description: 'The error codes @selvajs/compute can throw, which ones are retried, and what to do about each.'
---

# Errors and retries

Every failure is a `ComputeError`. Check its `code` (one of `ErrorCodes`), never its message. Messages can contain server text and may change.

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

An error also has `statusCode` (when the server answered), `context` (extra details, such as `requestId`) and `originalError`.

## The codes

### The request failed

Retries are off by default. The "Retried" column shows what is retried once you turn them on.

| Code                 | Means                                                           | Retried?                     | What to do                                 |
| -------------------- | --------------------------------------------------------------- | ---------------------------- | ------------------------------------------ |
| `NETWORK_ERROR`      | No connection, a 502/503/504, or a response that was cut off    | Yes                          | Check the server is running                |
| `CORS_ERROR`         | A browser request got no response, usually because of CORS      | Yes                          | See the package README's troubleshooting   |
| `TIMEOUT_ERROR`      | No answer within `timeoutMs`                                    | Yes                          | Raise `timeoutMs`, or use `0` for no limit |
| `RATE_LIMIT`         | HTTP 429, too many requests                                     | Yes, waits for `Retry-After` | Send fewer requests                        |
| `AUTH_ERROR`         | HTTP 401 or 403                                                 | No                           | Fix `apiKey` or `authToken`                |
| `NOT_FOUND`          | HTTP 404: the server has no such endpoint                       | No                           | Check `serverUrl` and the server version   |
| `VALIDATION_ERROR`   | HTTP 400 or 413, or an input failed a check before sending      | No                           | Fix the request. 413 means it is too large |
| `INVALID_RESPONSE`   | A 200 answer the client can't use, such as a proxy's login page | No                           | Check any proxy in front of Compute        |
| `RESPONSE_TOO_LARGE` | The answer was bigger than `maxResponseBytes`                   | No                           | Raise the limit or return less data        |

### The solve failed

| Code                | Means                                                       | What to do                              |
| ------------------- | ----------------------------------------------------------- | --------------------------------------- |
| `COMPUTATION_ERROR` | The solver reported errors, or the server failed (HTTP 500) | See [Partial success](#partial-success) |
| `UNKNOWN_ERROR`     | Anything not covered above                                  | Report the `requestId`                  |

For solver errors, `err.context.errors` lists them. For a server failure, `err.context.responseBody` holds the start of the server's answer.

### You passed something unusable

| Code             | Means                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------- |
| `INVALID_INPUT`  | An empty definition, a badly written tree path, or data that can't be turned into JSON |
| `INVALID_CONFIG` | A bad `serverUrl`, an unusable number, or a server that redirects                      |
| `INVALID_STATE`  | You used a client or scheduler after calling `dispose()`                               |

A redirect is rejected on purpose, because following it could send your API key to another address. Set `serverUrl` to the final address.

### Scheduler results

These come from `scheduler.solve`. The first two aren't real failures.

| Code            | Means                                               | What to do                             |
| --------------- | --------------------------------------------------- | -------------------------------------- |
| `SUPERSEDED`    | `latest-wins` mode: a newer call replaced this one  | Ignore it                              |
| `ABORTED`       | The call's `signal` or `cancelAll()` cancelled it   | Ignore it                              |
| `QUEUE_FULL`    | The queue already had `maxQueueDepth` calls waiting | Wait, then try again. Maps to HTTP 503 |
| `QUEUE_TIMEOUT` | The call waited longer than `queueWaitMs`           | Wait, then try again. Maps to HTTP 503 |

Skip the first two before you show an error:

```ts
scheduler.solve(definition, inputs).catch((err) => {
	if (err.code === ErrorCodes.SUPERSEDED || err.code === ErrorCodes.ABORTED) return;
	showError(err);
});
```

`DEFINITION_NOT_CACHED` means the server forgot a definition it was asked for by key. A scheduler handles this by uploading the file again, so you normally never see it.

## Partial success

A definition can succeed for some outputs and fail for others. Compute then answers with HTTP 500 but still includes the outputs that worked. The client treats that as a result, not a crash.

- `client.solve` throws `COMPUTATION_ERROR`. The outputs that worked are in `err.context.values`, and `err.context.errors` lists what failed.
- `scheduler.solve` returns the response. Read `errors` from it yourself.

To show the good outputs after `client.solve` throws:

```ts
import type { GrasshopperComputeResponse } from '@selvajs/compute/grasshopper';

if (err.code === ErrorCodes.COMPUTATION_ERROR && err.context?.values) {
	const partial = { values: err.context.values } as GrasshopperComputeResponse;
	const { values } = new GrasshopperResponseProcessor(partial).getValues();
}
```

## Retries

Retries are **off by default**. Turn them on for a client, a scheduler, or a single `client.solve` call:

```ts
const client = await GrasshopperClient.create({
	serverUrl,
	retry: { attempts: 2, baseDelayMs: 500, maxDelayMs: 30_000 }
});
```

`attempts` is how many times to try again after the first failure. The wait between tries doubles each time, plus a little randomness. If the server sends `Retry-After`, that wait is used instead.

Know these before turning retries on:

- **A retry can run the same solve twice.** If the connection drops after the server got the request, the first run may still be going. The same inputs give the same answer, so this only wastes time.
- **`timeoutMs` applies to each try.** The worst case is `(attempts + 1) × timeoutMs` plus the waits. Pass a `signal` if you need one overall deadline.

For solves that take minutes, read "Long jobs behind a proxy" in the package README. On Node, keep retries off past 300 seconds.

## Finding the cause of a failure

Every request has a `requestId`. It is sent to the server as the `X-Request-ID` header and is on most errors as `err.context.requestId`. Log it and look for it in the server's logs.

The package logs nothing until you give it a logger. Call `setLogger(console)` (or your own logger) from `/core`, then set `debug: true` in the config to log each request with its size, duration and retries. Logs show identifiers and sizes, never the data itself.
