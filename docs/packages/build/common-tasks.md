---
title: Common tasks
order: 5
published: true
description: 'Ready-to-copy patterns for @selvajs/compute: live sliders, batch jobs, cancelling, and loading definitions on demand.'
---

# Common tasks

These assume a connected `client`, a `definition` and an `io`. [How the compute client works](./how-it-works.md) shows how to get them.

## A live slider

The newest value wins, and repeated values answer instantly.

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

## A submit button with long jobs

```ts
const scheduler = client.createScheduler({ mode: 'queue', timeoutMs: 0 });

const controller = new AbortController();
cancelButton.onclick = () => controller.abort();

const response = await scheduler.solve(definition, inputs, { signal: controller.signal });
```

`timeoutMs: 0` means no limit. A proxy can still close an idle connection; see "Long jobs behind a proxy" in the package README.

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

Set `maxConcurrent` to the number of solves your server runs at once. On a shared server, add `maxQueueDepth` and `queueWaitMs`.

## Clean up

```ts
onDestroy(() => scheduler.dispose());
```

`dispose()` cancels running and waiting solves and empties the cache. Later calls fail with `INVALID_STATE`. Disposing the client disposes its schedulers.

## Show the outputs that worked

```ts
const response = await scheduler.solve(definition, inputs);
const errors = readField<string[]>(response, 'errors');
if (errors?.length) showWarnings(errors);

const { values } = new GrasshopperResponseProcessor(response).getValues();
showWhatExists(values);
```

Errored responses are cached too. If the definition reads outside its inputs (a web service), use `cache: { maxBytes, cacheErroredSolves: false }`.

## See how a solve went

```ts
const { response, fromCache, definitionReuploaded, durationMs } = await scheduler.solveDetailed(
	definition,
	inputs,
	{ onServerTiming: (timing) => log(timing.solve, timing.gh) }
);
```

The scheduler's `onSettle` runs when any solve finishes, fails or is cancelled; `onSuperseded` runs for solves replaced in `latest-wins`. `onServerTiming` doesn't run for cache hits.

## Load definition bytes on demand

Pass a `DefinitionRef` to fetch bytes from storage only when an upload is needed.

```ts
import type { DefinitionRef } from '@selvajs/compute/core';

const definition: DefinitionRef = {
	key: versionId, // one exact file: a version id, never a file name
	load: (signal) => storage.read(versionId, { signal })
};

await scheduler.solve(definition, inputs);
```

Only the first solve calls `load()`. The `key` is trusted: two files sharing one return each other's results.

## Solve from a URL

```ts
await client.solve('https://example.com/definition.gh', inputs);
```

The Compute server downloads the file, so it must reach the URL.

## Download file outputs

Needs the Selva plugin and the VektorNode fork.

```ts
import { downloadFileDataByRoot } from '@selvajs/compute/core';

const files = [processor.getValue({ byName: 'Export' })].flat();
await downloadFileDataByRoot(files, 'export');
```

This runs in a browser. In Node, group files with `groupFilesByRoot` and write them yourself. The package README covers the `Sub Folder` convention.
