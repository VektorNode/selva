---
title: Build your own app
group: Get Started
order: 6
published: false
description: 'Embed the Selva viewer and controls in your own product using the @selvajs/* packages.'
---

# Build your own app

The standalone `@selvajs/selva` app is enough for most teams. But everything it does also ships as npm packages, so you can drop the viewer, the controls, and the solve pipeline straight into a product of your own.

Take this path when you want your own branding, your own routes, and your own domain model, with Selva doing the parametric work underneath.

## The model

Build a normal SvelteKit app, add the `@selvajs/*` packages, and wrap them in whatever you're building.

```mermaid
flowchart TB
    routes["Your routes, branding, domain logic<br/>(the product you build)"]
    ui["@selvajs/ui<br/>viewer + controls"]
    compute["@selvajs/compute<br/>Rhino.Compute client"]
    schemas["@selvajs/schemas<br/>schema types"]
    platform["@selvajs/platform + a provider<br/>backend: auth, data, storage"]
    rc["Rhino.Compute<br/>(your solve server)"]

    routes -->|renders| ui
    routes -->|reads/writes| platform
    routes -->|sends inputs to| compute
    ui -->|speaks| schemas
    compute -->|speaks| schemas
    compute -->|solves over HTTP| rc
```

Read it top-down. **Your app** is the product. It pulls in the viewer (`ui`), the compute client, and a backend (`platform` + a provider) as building blocks. `ui` and `compute` both speak the same schema contract (`schemas`), and `compute` is the only piece that talks to your Rhino.Compute server. Take only the boxes you need.

## Building blocks

| Package                          | Gives you                                                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `@selvajs/ui`                    | Svelte components, theme, and the 3D viewer: the same pieces the Selva app is built from. Style them to your brand. |
| `@selvajs/compute`               | Type-safe Rhino.Compute client. Turns inputs into solved geometry. No renderer. See below.                          |
| `@selvajs/schemas`               | Schema types and traversal helpers, so your app speaks the same contract as the plugin.                             |
| `@selvajs/platform` + a provider | The backend contract, plus an implementation of it. See [Providers](../providers.md).                               |

Mix and match. If you only want the viewer and solving inside an otherwise custom app, `@selvajs/ui` and `@selvajs/compute` are enough on their own.

## Getting started

These are ordinary npm packages. Install what you need, then point the compute client at your Rhino.Compute server ([step 1](overview.md)).

```bash
pnpm add @selvajs/ui @selvajs/compute @selvajs/schemas
# + @selvajs/platform and a provider for Selva's backend model
```

Each package README covers its own imports and setup. [`@selvajs/ui`](https://www.npmjs.com/package/@selvajs/ui) is the best place to start; for solving, read on.

## The compute client

[`@selvajs/compute`](https://www.npmjs.com/package/@selvajs/compute) talks to Rhino.Compute and nothing else; it has no renderer and no `three` dependency. It gives you:

- Calls to Compute that return geometry, with errors you can narrow on instead of guess at.
- Reading and writing Grasshopper **data trees**.
- The same API in the browser and in Node.

Import from `/grasshopper` or `/core`, whichever you need, so a bundler drops the rest. The root export is empty on purpose, so importing from the bare package name gets you nothing.

Turning a solve response into Three.js objects is a separate job, and [`@selvajs/visualization`](https://www.npmjs.com/package/@selvajs/visualization) does it. Import from `/scene`, `/render`, or `/parse`.

**Full API reference: <https://vektornode.github.io/selva-compute/>**

## Next

- [Architecture](../architecture.md): how these relate to the plugin and Compute.
- [Providers](../providers.md): wiring in a backend.
