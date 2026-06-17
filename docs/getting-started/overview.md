---
title: Get Started Overview
group: Get Started
order: 1
published: true
---

# Get Started

Three steps to a working deployment, plus an optional fourth for building your own app.

| Step                               | What you do                                                                      |
| ---------------------------------- | -------------------------------------------------------------------------------- |
| **1. Rhino.Compute**               | Stand up the headless Rhino that solves your definitions.                        |
| **2. Selva plugin**                | Design the schema in Grasshopper, save it into the `.gh`.                        |
| **3. Deploy the app**              | Scaffold `@selvajs/selva`, point it at Compute, pick a provider.                 |
| **4. Build your own** _(optional)_ | Consume the `@selvajs/*` packages to embed the Selva viewer in your own product. |

## Before you start

Going live means running two servers: a **Compute server** (Rhino that solves your definitions) and the **app server** (the website your users visit). That's normal for a web app, but if it's new to you, here's the mental model:

- **Compute server** — a Windows machine (usually a cloud VM you rent) running Rhino headlessly. "Headless" just means no screen or mouse: it sits there and solves Grasshopper definitions whenever the app asks. Step 1.
- **App server** — any machine that runs the Selva web app and serves it to browsers. Step 3.
- **Provider** — your choice of backend for logins and storage. The simplest one (`local`) just uses files on disk and needs nothing extra, so you can ignore this until step 3.

If you only want to _see Selva working on your own machine_ before committing to servers, follow [Local Dev Setup](../QuickStart.md) instead — it runs the whole app locally. You'll still need a Compute server to actually solve geometry, but everything else runs on your laptop.

## 1. Rhino.Compute

The headless Rhino that solves your definitions at run time. Use the [VektorNode fork](https://github.com/VektorNode/compute.rhino3d) (adds block-instance support). Install Selva and any plugins your definitions need under the `rhino.compute` account.

See [Rhino Compute Setup](../RhinoCompute.md).

## 2. Plugin + schema

1. Install **Selva** from the Grasshopper Package Manager.
2. Restart Rhino.
3. Drop the Selva UI Builder onto your definition and open the designer.
4. Drag inputs into controls, lay them out, save. The schema is written into the `.gh`.

Install the same `.gha` on the Compute server (step 1) so the deployed app can solve it.

## 3. Deploy the web app

```bash
npx @selvajs/cli my-deployment   # scaffolds the app; prompts for provider, origin, tenancy, secrets
cd my-deployment
npm run doctor                   # checks your config is valid
npm start                        # launches the app (under pm2, a process manager that keeps it running)
```

`npx` runs the Selva command-line tool without installing it first. It asks you a few questions (which provider, your site's URL, etc.) and writes out a ready-to-run app folder.

Then: visit `/setup` to create the admin (first boot only), register your Compute server at `/admin/compute`, upload a definition, share the link. Pick your backend here via provider settings; see [Providers](../providers.md).

See [CLI](../CLI.md), [Local dev setup](../QuickStart.md), [Linux deploy](../deployment/GCE-Linux.md).

## 4. (Optional) Build your own app

Want your own branding, domain features, or the viewer embedded in a larger product? Consume the `@selvajs/*` packages directly.

See [Build your own app](build-your-own-app.md).
