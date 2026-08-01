---
title: UI Builder
group: Plugin
order: 2
published: true
description: 'The UI Bridge component, the schema, and how a definition becomes a web interface.'
---

# UI Builder

Every Selva definition needs exactly one **UI Bridge** (Selva → UI). It is the link between the Grasshopper canvas and the web interface.

## What the schema is

The **schema** is the description of your app's interface: which parameters are controls, what kind of control each one is, how they're grouped and ordered, and what the outputs are.

It lives **inside the `.gh` file**. That matters — the definition and its interface travel together as one artefact. Upload the `.gh` and the deployed app knows how to render it.

## What the UI Bridge does

Its job depends on where it's running.

**On the canvas, in Rhino:**

- Discovers the definition's inputs (the `Get …` params, plus ordinary sliders and toggles) and its outputs.
- Runs a local HTTP server and a WebSocket server (port 8765) that the schema designer connects to.
- Keeps the designer and the canvas in sync — change a value in the browser and the definition re-solves; change the definition and the designer updates.
- Writes the schema back into the `.gh` when you save.
- After each solve, scans for **ContextBake** components and merges newly-wired outputs into the schema — or drops ones you've unwired.

**On Rhino.Compute, at run time:** none of the above. It detects the headless environment, emits the embedded schema, and stops. No servers, no background tasks.

| Param    | Direction | Notes                                                          |
| -------- | --------- | -------------------------------------------------------------- |
| `Enable` | in        | Set true to start the servers and open the designer.           |
| `Schema` | out       | The current schema. Feed it to **Evaluate Schema** to inspect. |
| `URL`    | out       | The designer's address. Empty until the servers are up.        |

## Building an interface

1. Drop the UI Bridge and set `Enable` to true.
2. Open the URL it outputs.
3. Drag the discovered inputs into controls, group and order them, pick widget types.
4. Save. The schema goes into the `.gh`.

Any parameter you don't place stays out of the interface — discovery is not the same as inclusion.

## Getting outputs into the schema

Two rules:

- **Display** is picked up automatically.
- **Everything else** — files, rendered drawings, dynamic value lists — needs its output wired into a **ContextBake** component. The UI Bridge notices it after the next solve and adds it.

If an output isn't showing up in the designer, a missing ContextBake is the first thing to check.

## Evaluate Schema

A debugging component. Feed it the UI Bridge's `Schema` output and it prints a readable summary, the raw JSON, and the input and output counts. Useful when the designer shows something you didn't expect and you want to see what's actually stored.

## Next

- [Inputs](../plugin/compute-io.md): the parameters that become controls.
- [Dynamic value lists](../plugin/dynamic-value-lists.md): the one output that loops back to an input.
- [Architecture](../architecture.md): the design-time WebSocket round-trip in detail.
