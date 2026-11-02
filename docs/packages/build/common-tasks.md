---
title: Common tasks
order: 5
published: true
description: 'Ready-to-copy patterns for @selvajs/compute: live sliders, batch jobs, cancelling, and loading definitions on demand.'
---

# Common tasks

These assume you already have a connected `client`, a `definition` and an `io`. [How the compute client works](./how-it-works.md) shows how to get them.

## A live slider

Run one solve at a time, let the newest value win, and answer repeated values instantly.

```ts
const scheduler = client.createScheduler({
	mode: 'latest-wins',
	timeoutMs: 30_000,
	cache: { maxBytes: 64 * 1024 * 1024 }
});

let inputs = TreeBuilder.fromInputParams(io.inputs);

async function onSliderChange(value: number) {
	inputs = TreeBuilder.replaceTreeValue(inputs, 'Radius', value);
	try {
		render(await scheduler.solve(definition, inputs));
	} catch (err) {
		if (err.code === ErrorCodes.SUPERSEDED || err.code === ErrorCodes.ABORTED) return;
		showError(err);
	}
}

scheduler.subscribe(() => {
	spinner.visible = scheduler.isSolving;
});
```

`latest-wins` cancels the outdated solve instead of waiting for it. The cache answers a slider that goes back to an earlier value without sending a request.

## A submit button with long jobs

Every job runs, in order, and the user can cancel.

```ts
const scheduler = client.createScheduler({ mode: 'queue', timeoutMs: 0 });

const controller = new AbortController();
cancelButton.onclick = () => controller.abort();

const response = await scheduler.solve(definition, inputs, { signal: controller.signal });
```

`timeoutMs: 0` means no time limit. A proxy in front of Compute can still close a connection that sits idle for too long. See "Long jobs behind a proxy" in the package README.

## Many solves at once

```ts
const scheduler = client.createScheduler({
	mode: 'queue',
	maxConcurrent: 4,
	timeoutMs: 60_000,
	retry: { attempts: 2 }
});

const responses = await Promise.all(variants.map((tree) => scheduler.solve(definition, tree)));
```

Set `maxConcurrent` to roughly the number of solves your Compute server can run at the same time. Higher values just make the extra requests wait on the server. If that number changes later, call `scheduler.setMaxConcurrent(n)`.

On a shared server, also set `maxQueueDepth` and `queueWaitMs`. A burst of requests is then turned away quickly instead of waiting forever.

## Clean up when you're done

```ts
onDestroy(() => scheduler.dispose());
```

`dispose()` cancels everything running or waiting, empties the cache, and makes later calls fail with `INVALID_STATE`. Disposing the client disposes every scheduler made from it.

## Show the outputs that worked

A scheduler returns the response even when the solver reported errors:

```ts
const response = await scheduler.solve(definition, inputs);
const errors = readField<string[]>(response, 'errors');
if (errors?.length) showWarnings(errors);

const { values } = new GrasshopperResponseProcessor(response).getValues();
showWhatExists(values);
```

By default, a response with errors is cached like any other, because Grasshopper errors usually depend only on the inputs. If your definition reads something outside its inputs, such as a web service, errors may be temporary. Then use `cache: { maxBytes, cacheErroredSolves: false }`.

## See how a solve went

```ts
const { response, fromCache, definitionReuploaded, durationMs } = await scheduler.solveDetailed(
	definition,
	inputs,
	{
		onServerTiming: (timing) => log(timing.solve, timing.gh)
	}
);
```

For metrics across all solves, the scheduler's `onSettle` option runs when a solve finishes, fails or is cancelled. A solve replaced in `latest-wins` mode runs `onSuperseded` instead. `onServerTiming` doesn't run for cache hits, because no request was sent.

## Load definition bytes on demand

If your definitions live in storage, pass a `DefinitionRef` instead of the bytes. The bytes are fetched only when an upload is needed.

```ts
import type { DefinitionRef } from '@selvajs/compute/core';

const definition: DefinitionRef = {
	key: versionId, // identifies one exact file: a version id, never a file name
	load: (signal) => storage.read(versionId, { signal })
};

await scheduler.solve(definition, inputs);
```

The first solve calls `load()` and uploads the file. Later solves send only the server's key and never call `load()`. A solve cancelled while it waits in the queue doesn't load anything either. Pass `signal` on to your storage read, so cancelling a solve also stops the read.

The `key` is trusted. If two different files share a key, each gets the other's results and nothing warns you. Use a version or content id.

## Solve a definition from a URL

```ts
await client.solve('https://example.com/definition.gh', inputs);
```

The Compute server downloads the file itself, so the URL must be reachable from the server. Nothing is uploaded, so server definition reuse has nothing to do.

## Download file outputs

File outputs need the Selva plugin and the VektorNode fork.

```ts
import { downloadFileDataByRoot } from '@selvajs/compute/core';

const files = [processor.getValue({ byName: 'Export' })].flat();
await downloadFileDataByRoot(files, 'export');
```

This runs in a browser. In Node, use `groupFilesByRoot` to group the files the same way, then write them yourself. The package README explains the `Sub Folder` convention and the resulting archive layout.
