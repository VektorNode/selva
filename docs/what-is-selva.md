---
title: What is Selva
group: Concepts
order: 1
published: true
---

# What is Selva

Selva turns a **Grasshopper definition** into a **web app**. No Rhino, no Grasshopper knowledge, no install for your users.

A designer builds parametric logic once in Grasshopper. Selva exposes its inputs as web controls, solves the definition on a server, and renders the geometry in a browser 3D viewer. Anyone with a link can drive the model.

## The problem

Grasshopper logic stays locked inside Rhino on the author's machine. Sharing it means sharing a `.gh` file, a Rhino license, and the expectation that the recipient knows Grasshopper. Selva removes that wall: the definition becomes a URL with a clean UI and a live 3D view.

## Two halves

- **The plugin** (`Selva.gha`) is where the author _designs the interface_. It reads the definition's parameters, maps them to web controls via a drag-and-drop designer, and saves that layout (the **schema**) into the `.gh` file.
- **The web app** (`@selvajs/selva`) is where the interface _runs_. It loads the schema, renders the controls, and solves the definition through **Rhino.Compute** (headless Rhino). End users need no Rhino.

One schema drives both, generated into TypeScript (UI) and C# (plugin) so they never drift.

## The flow

```mermaid
flowchart LR
    subgraph author["Author in Rhino"]
        a["Selva.gha reads inputs<br/>author maps to controls<br/>schema saved in the .gh"]
    end
    subgraph server["Deployed on a server"]
        b["@selvajs/selva loads schema<br/>solves via Rhino.Compute"]
    end
    subgraph user["End user in a browser"]
        c["changes a value<br/>sees geometry update live"]
    end
    author --> server --> user
```

## What you get

- **Schema designer.** Map parameters to controls visually, no front-end code.
- **Live 3D viewer.** Grasshopper geometry in the browser via Three.js.
- **Cloud solving.** Runs on Rhino.Compute; users need no Rhino.
- **Type-safe end to end.** One schema, both stacks generated from it.
- **Bring your own backend.** Auth, data, storage are pluggable [providers](providers.md).

## Two ways to use it

1. **Deploy the standalone app** with `@selvajs/selva` + the [CLI](CLI.md). A multi-user platform for hosting and sharing definitions. Most teams take this path.
2. **Build your own app.** Selva's viewer, controls, and compute client ship as `@selvajs/*` npm packages to embed in your own product. See [Build your own app](getting-started/build-your-own-app.md).

## Next

- [Architecture](architecture.md): how the parts fit together.
- [Providers](providers.md): the bring-your-own-backend model.
- [Get Started](getting-started/overview.md): set it up.
