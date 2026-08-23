---
title: What is Selva
order: 1
published: true
description: "Your workflow, everyone's tool: the problem Selva solves and the two halves that make it work."
---

# What is Selva

**Your workflow, everyone's tool.**

A few specialists build a Grasshopper definition. Everyone else needs what it produces, not the canvas it runs on. Selva puts a web UI and a live 3D viewer in front of the definition, so the rest of the company can use it through a link. The file stays on your server.

Selva is open source (MIT) and free to self-host and modify.

## Where it came from

The definitions worth sharing are the ones you can least afford to hand out. Years of production logic, tolerances, and rules of thumb, kept by a handful of people who know how it fits together.

Sending someone the `.gh` file has two problems. They need a Rhino license and enough Grasshopper knowledge to open it without breaking something. And they now have the method permanently, to reuse or pass on.

So the logic stays with the people who wrote it. Everyone else files a request and waits.

Selva closes that gap. You hand out a URL instead of the file. Colleagues drive the model and get geometry back. Roles decide who can change a definition and who can only run it.

## Two halves

**The Selva plugin** is where you design the interface, entirely from Grasshopper. Drop components on the canvas to mark which parameters users drive and what comes back out. Sliders and toggles become web controls on their own. Dedicated components cover dropdowns, color pickers, and file and image uploads. Then a designer panel, linked live to the running Rhino session, lets you drag those parameters into tabs and groups. That layout is the **schema**, and it saves into the `.gh` file itself. No separate design tool, no code.

**The web app** is where the interface runs. It loads the schema, draws the controls, and solves through **Rhino.Compute**, a headless Rhino that does nothing but solve definitions on request.

One schema drives both. It generates into TypeScript and C#, so the two never drift.

## Two ways to run the web half

Take the whole app, or just the parts you need:

1. **Use the Selva platform.** `@selvajs/selva` plus the [CLI](./self-hosting/get-started/cli.md) is a ready-made multi-user app. It gives you organizations, projects, and roles that separate who can edit a definition's schema from who can only run it. Most teams take this path.
2. **Build your own app.** The same parts ship as `@selvajs/*` npm packages: a Rhino.Compute client, the 3D viewer, the Svelte UI layer, and provider interfaces for auth and storage. Build one API endpoint for an existing internal tool, or a full custom application. See [Build your own app](./packages/build/overview.md).

Auth, data, and storage are pluggable [providers](./self-hosting/providers/overview.md) either way.

## Next

- [Architecture](./architecture.md): how the parts fit together.
- [Permissions](./self-hosting/concepts/permissions.md): who can edit, who can only run.
- [Get Started](./self-hosting/get-started/overview.md): set it up.
