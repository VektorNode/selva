---
title: What is Selva
order: 1
published: true
description: 'Turn a Grasshopper definition into a web app: the problem it solves and the two halves that make it work.'
---

# What is Selva

Selva turns a **Grasshopper definition** into a **web app**. A designer builds parametric logic once in Grasshopper; Selva exposes its inputs as web controls, solves the definition on a server, and renders the geometry in a browser 3D viewer. Users need no Rhino, no Grasshopper knowledge, and no install.

## The problem

Grasshopper logic stays trapped inside Rhino on the author's machine. Sharing it means handing over a `.gh` file and expecting the other person to own a Rhino license and know Grasshopper well enough to open it without breaking anything.

Handing over the file also hands over the method, not just the result — the tolerances and the rules of thumb. Send the `.gh` to a client or contractor and they have your process permanently, to reuse or pass on.

With Selva the definition stays on your server; what you share is a URL with a UI and a live 3D view. Users drive the model and get geometry back; they never see the canvas.

## Two halves

- **The Selva plugin** is where you _design the interface_. Install it into Grasshopper and drop its components on the canvas to mark which parameters users drive and what comes back out. It opens a designer where you arrange those parameters into web controls and saves that layout — the **schema** — into the `.gh` file itself.
- **The web app** (`@selvajs/selva`) is where that interface _runs_. It loads the schema, draws the controls, and solves through **Rhino.Compute**: a headless Rhino on a server that does nothing but solve definitions on request.

One schema drives both, generated into TypeScript (UI) and C# (plugin) so they never drift.

## Two ways to use it

1. **Deploy the standalone app** — `@selvajs/selva` plus the [CLI](./self-hosting/get-started/cli.md). A multi-user platform for hosting and sharing definitions. Most teams take this path.
2. **Build your own app** — the viewer, controls, and compute client ship as `@selvajs/*` npm packages. See [Build your own app](./packages/build/overview.md).

Auth, data, and storage are pluggable [providers](./self-hosting/providers/overview.md) either way.

## Next

- [Architecture](./architecture.md): how the parts fit together.
- [Providers](./self-hosting/providers/overview.md): the bring-your-own-backend model.
- [Get Started](./self-hosting/get-started/overview.md): set it up.
