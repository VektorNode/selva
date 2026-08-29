# `client/` — app-side solve state

This folder keeps the state that sits between a UI and a solver. It tracks the current input values,
whether a solve is running, the last result, and what should happen when the definition changes.

It only knows about `SolveResult` from `shared/`. Inputs go out, results come back. That is what
lets the same session work with a WebSocket app, an HTTP app, or a headless tool. It must never
import `../server/*`.

## Main pieces

| File                          | What it does                         |
| ----------------------------- | ------------------------------------ |
| `solve-session.ts`            | Creates the session                  |
| `solve-session-core.ts`       | Holds the state changes              |
| `drivers/driver.ts`           | Defines the transport boundary       |
| `drivers/request-response.ts` | Request/response driver              |
| `compute-fetch-solve-fn.ts`   | Ready-made HTTP solve function       |
| `async-throttle.ts`           | Keeps only one solve in flight       |
| `solve-memo.ts`               | Caches results on the client         |
| `external-storage.ts`         | Stores inputs while they move around |

## Typical flow

1. The UI changes input values.
2. The session sends those values to a driver.
3. The driver gets a result back and reports it.
4. The UI reads the latest state from the session.

```ts
const session = createSolveSession({ driver: createRequestResponseDriver() });
session.solve({ width: 10, height: 20 });
```

```ts
session.subscribe(() => {
	updateStatus(session.isSolving);
	updateResult(session.lastResult);
});
```

## What a `values` map is

`values` is the current input map for the active definition. In a real app it usually comes from the
form state or from a Grasshopper input tree. If you need to build or edit that tree first, see
[`packages/compute/src/grasshopper/README.md`](../../../compute/src/grasshopper/README.md#data-trees)
and [`packages/compute/src/grasshopper/data-tree/README.md`](../../../compute/src/grasshopper/data-tree/README.md).

## How the session updates the UI

The session exposes plain getters. To make a UI update, subscribe once and then copy the state into
your own framework.

```ts
let version = $state(0);
$effect(() => session.subscribe(() => (version += 1)));
```

`@selvajs/ui` already does that for Svelte apps as `useSolveSession`.

`isSolving` comes from the driver. If the driver changes it, call `session.notify()` so the UI
re-renders.

```ts
const driver = createRequestResponseDriver(onSolve, () => session, {
	onChange: () => session.notify()
});
```

## Writing a driver

A driver starts and cancels solves. It does not return results directly; the reporter sends results
back later.

```ts
const myDriver: SolveDriver = {
	solve(values) {
		/* send the values */
	},
	cancel() {
		/* stop the current solve */
	},
	get isSolving() {
		return inFlight;
	}
};
```

```ts
getReporter().report({ outputs, meshes, errors, warnings });
```

If the transport fails, call `reportError(message)`.

## Real-world examples

### WebSocket app

Use this when a plugin or local service pushes results back to the app.

```ts
const session = createSolveSession({ driver: createRequestResponseDriver() });
session.solve(values);
```

### HTTP app

Use the HTTP solve helper when the server responds to a request.

```ts
const solve = createComputeFetchSolveFn({
	endpoint: '/api/compute',
	definitionUrl: () => '/definition.gh'
});
```

### Headless tool

Use the shared result type when you just need to pass solve results through your own code.

```ts
import type { SolveResult } from '@selvajs/solve/shared';
```

## Mesh ownership

If your app renders meshes, it owns them. The session does not know what a mesh is, so the cache
needs a policy from the host.

```ts
import { meshPolicy } from '@selvajs/visualization/parse';
const driver = createRequestResponseDriver(onSolve, () => session, { meshPolicy });
```

Without a policy, the memo stores meshes by reference. That only works when nothing else disposes
them.
