---
title: What is Selva
group: Concepts
order: 1
published: false
description: 'Turn a Grasshopper definition into a web app: the problem it solves and the two halves that make it work.'
---

# What is Selva

Selva turns a **Grasshopper definition** into a **web app**. No Rhino, no Grasshopper knowledge, no install for your users.

A designer builds parametric logic once in Grasshopper. Selva exposes its inputs as web controls, solves the definition on a server, and renders the geometry in a browser 3D viewer. Anyone with a link can drive the model.

## The problem

Grasshopper logic stays trapped inside Rhino on the author's machine. Sharing it means handing over a `.gh` file, expecting the other person to own a Rhino license, and expecting them to know Grasshopper well enough to open it without breaking anything.

And handing over the file hands over everything in it. A definition is the method, not just the result: the tolerances, the rules of thumb, the years of solving the same problem badly until it came out right. Send the `.gh` to a client or a contractor and they have your process, permanently, to reuse or pass on.

Selva takes down both walls. The definition stays on your server; what you share is a URL with a clean UI and a live 3D view. Users drive the model and get geometry back; they never see the canvas.

## Two halves

- **The Selva plugin** is where you _design the interface_. You install it into Grasshopper and drop its components on the canvas to mark which parameters your users get to drive and what comes back out. It opens a designer where you arrange those parameters into web controls, and saves that layout, the **schema**, into the `.gh` file itself.
- **The web app** (`@selvajs/selva`) is where that interface _runs_. It loads the schema, draws the controls, and solves the definition through **Rhino.Compute**: a copy of Rhino on a server with no window and no mouse, doing nothing but solving definitions on request. Your users never touch Rhino.

One schema drives both, generated into TypeScript (UI) and C# (plugin) so they never drift.

## What you get

- **Schema designer.** Map parameters to controls visually, no front-end code.
- **Live 3D viewer.** Grasshopper geometry in the browser via Three.js.
- **Cloud solving.** Runs on Rhino.Compute; users need no Rhino.
- **Type-safe end to end.** One schema, both stacks generated from it.
- **Bring your own backend.** Auth, data, storage are pluggable [providers](providers.md).

## Two ways to use it

1. **Deploy the standalone app** with `@selvajs/selva` + the [CLI](CLI.md) (a command-line tool that sets up and runs your deployment for you). A multi-user platform for hosting and sharing definitions. Most teams take this path.
2. **Build your own app.** Selva's viewer, controls, and compute client ship as reusable `@selvajs/*` code packages you can drop into your own product. See [Build your own app](getting-started/build-your-own-app.md).

## Next

- [Architecture](architecture.md): how the parts fit together.
- [Providers](providers.md): the bring-your-own-backend model.
- [Get Started](getting-started/overview.md): set it up.
