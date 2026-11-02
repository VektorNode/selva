---
title: How the compute client works
order: 2
published: true
description: 'What a solve is, how a request travels through @selvajs/compute, and when to use a scheduler instead of calling solve directly.'
---

# How the compute client works

`@selvajs/compute` sends a Grasshopper definition and some input values to a Rhino.Compute server and gives you back the results. It doesn't draw anything. To turn the results into 3D objects, use `@selvajs/visualization`.

## The words used here

- **Definition**: a Grasshopper `.gh` file.
- **Solve**: one request. You send a definition plus input values, and Compute sends back the outputs.
- **Data tree**: how Grasshopper stores values, as lists grouped into branches. Both inputs and outputs use it. See [Data trees](./data-trees.md).
- **IO**: the list of inputs and outputs a definition has: names, types, defaults, min and max. You fetch it once, then build your UI or your request from it.
- **Scheduler**: a helper that manages many solves over time. It cancels outdated ones, queues the rest and remembers repeated answers.

## The five steps

```ts
import {
	GrasshopperClient,
	TreeBuilder,
	GrasshopperResponseProcessor
} from '@selvajs/compute/grasshopper';

// 1. Connect. The client checks the server first, so a wrong URL fails here.
const client = await GrasshopperClient.create({ serverUrl, apiKey });

// 2. Ask the definition what inputs it has.
const io = await client.getIO(definition);

// 3. Build the input values, starting from the defaults.
let inputs = TreeBuilder.fromInputParams(io.inputs);
inputs = TreeBuilder.replaceTreeValue(inputs, 'Radius', 10);

// 4. Solve.
const response = await client.solve(definition, inputs);

// 5. Read the outputs.
const { values } = new GrasshopperResponseProcessor(response).getValues();
```

`definition` can be:

- a URL, which the Compute server downloads itself
- the `.gh` file's bytes (a `Uint8Array`), which are uploaded
- a `DefinitionRef`, which loads the bytes only when needed (see [Common tasks](./common-tasks.md#load-definition-bytes-lazily))

A plain file name doesn't work as a path. The client would send the name itself as if it were the definition.

## What happens during a solve

1. `client.solve` checks your input.
2. It builds the request: a URL is sent as a link, and bytes are sent as base64 text.
3. It sends the request over HTTP, with a timeout, cancellation, optional retries and a size limit.
4. Rhino.Compute runs Grasshopper and answers with `values`, `errors` and `warnings`.
5. `GrasshopperResponseProcessor` turns each output into a normal JavaScript value.

The HTTP part, `fetchCompute`, knows nothing about Grasshopper. It is exported from `/core` in case you need to call another endpoint, but most people never use it directly.

## `client.solve` or a scheduler?

`client.solve` sends one request and nothing more. Use it for scripts, tests and one-off jobs.

A UI needs more. A slider can fire many solves per second, the user can leave while one is running, and the same inputs come back again and again. A scheduler handles that. Create one with `client.createScheduler(options)`:

| You want                               | Use                                               |
| -------------------------------------- | ------------------------------------------------- |
| Only the newest slider value to count  | `mode: 'latest-wins'`, which cancels older solves |
| Every submitted job to run, in order   | `mode: 'queue'`                                   |
| Several jobs at once                   | `mode: 'queue'` with `maxConcurrent`              |
| To stop requests piling up on a server | `maxQueueDepth` and `queueWaitMs`                 |
| To cancel when a component goes away   | `scheduler.cancelAll()`, or a `signal` per call   |
| Instant answers for repeated inputs    | `cache: { maxBytes }`                             |
| A spinner or a disabled button         | `subscribe()`, `isSolving`, `hasPending`          |

Make one scheduler per part of your UI. Each has its own queue, cancellation and cache. The [package README](https://www.npmjs.com/package/@selvajs/compute) has recommended settings for common cases.

### The one difference to remember

When the solver reports errors:

- `client.solve` **throws** a `COMPUTATION_ERROR`.
- `scheduler.solve` **returns** the response, errors included. You check for them.

```ts
import { readField } from '@selvajs/compute/core';

const response = await scheduler.solve(definition, inputs);
const errors = readField<string[]>(response, 'errors');
if (errors?.length) showError(errors.join('\n'));
```

A definition can succeed for some outputs and fail for others. With a scheduler you get all of it back and can show what worked. With `client.solve`, the outputs that worked are inside the thrown error. See [Errors and retries](./errors.md#partial-success).

## Two caches

The scheduler can remember two different things. Don't mix them up.

|                    | Response cache                          | Server definition reuse                               |
| ------------------ | --------------------------------------- | ----------------------------------------------------- |
| What it remembers  | The full answer for a set of inputs     | That the server already has your `.gh` file           |
| What it saves      | The whole request                       | Uploading the file again                              |
| Where              | In your app, inside the scheduler       | The server holds the file; your app keeps its key     |
| Default            | Off. Turn on with `cache: { maxBytes }` | On. Turn off with `reuseServerDefinitionCache: false` |
| When it can't help | The solve runs as normal                | The file is uploaded again, automatically             |

A response-cache hit sends no request at all. `solveDetailed()` tells you for each call whether the answer came `fromCache` and whether the file was uploaded again.

Both caches identify a definition by its content, not its name. Two rules follow:

- **Don't change a `Uint8Array` after you've solved with it.** The scheduler remembers the fingerprint of a buffer. If you change the bytes, it still treats them as the old file and may return old answers.
- **A `DefinitionRef` key must identify one exact file**, such as a version id. Never use a file name. The key is trusted without looking at the bytes.

Cached answers are shared, not copied. Treat them as read-only.

## Using it in a browser

Anything you pass to the client in a browser, including the server URL and API key, is visible to every visitor. Call Compute from your own backend, or send requests through a proxy you control. If the client runs in a browser and a logger is set, it logs a warning. `suppressBrowserWarning` turns that off once you've decided it's fine.

A browser also needs the server to allow cross-origin requests (CORS). Stock Rhino.Compute doesn't. The package README's troubleshooting section explains the options.

## What needs the VektorNode fork

Plain solving works with stock Rhino.Compute. Input groups, input ids, file outputs and block instances need the [VektorNode fork](https://github.com/VektorNode/compute.rhino3d). Some also need the Selva plugin. The package README lists them under Requirements, and the API reference marks each affected feature.

## Next

- [Data trees](./data-trees.md): what paths like `{0;1}` mean and how to build inputs.
- [Errors and retries](./errors.md): what each error code means and what to do.
- [Common tasks](./common-tasks.md): sliders, batch jobs, cancelling, loading geometry.
- Full API reference: <https://selva.dev/docs/api/compute/>
