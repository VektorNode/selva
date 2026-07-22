---
title: UI Builder
group: Plugin
order: 2
published: true
description: 'Map Grasshopper parameters to web controls with the drag-and-drop schema designer.'
---

# UI Builder

The heart of the plugin. The **UI Bridge** component (canvas name "UI Bridge", in Selva → UI) links a Grasshopper definition to its schema and runs the WebSocket bridge (default port 8765) that the schema designer connects to.

## What it does

- Discovers the definition's inputs and outputs.
- Hosts the WebSocket server the designer talks to at design time.
- Persists the schema you build back into the `.gh` file.
- At run time on Rhino.Compute, evaluates the definition against incoming inputs.

## Using it

1. Drop the UI Bridge onto your definition.
2. Open the schema designer (the plugin UI).
3. Drag inputs into web controls, group and lay them out.
4. Save. The schema is written into the `.gh`.

See the [design-time path](../architecture.md) for how the WebSocket round-trip works.

## Next

- [Plugin overview](../plugin/overview.md)
- [Display](../plugin/display.md): control how outputs render.
