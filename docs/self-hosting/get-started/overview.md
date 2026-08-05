---
title: Get Started Overview
group: Get Started
order: 1
published: false
description: 'Three steps to a live deployment, plus the mental model for compute vs. app servers.'
---

# Get Started

Getting a definition online takes three steps. There's an optional fourth if you'd rather build your own app around it.

| Step                               | What you do                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------ |
| **1. Rhino.Compute**               | Set up the headless Rhino that solves your definitions.                        |
| **2. Selva plugin**                | Design the schema in Grasshopper and save it into the `.gh`.                   |
| **3. Deploy the app**              | Scaffold `@selvajs/selva`, point it at Compute, pick a provider.               |
| **4. Build your own** _(optional)_ | Use the `@selvajs/*` packages to put the Selva viewer inside your own product. |

## Just want to look around first?

You don't have to rent a server to try this. [Local Dev Setup](../QuickStart.md) runs the whole app on your laptop. You'll still need somewhere to solve geometry, but everything else is local. It's the fastest way to get a feel for the thing before committing to any infrastructure.

## Before you start

Going live means running two machines, which sounds like more than it is:

- **A Compute server:** a Windows machine, usually a cloud VM you rent, running Rhino with no screen and no mouse. It sits there and solves definitions whenever your app asks. That's step 1.
- **An app server:** anything that can run the Selva web app and serve it to browsers. That's step 3.

You'll also hear about **providers**. That's just where logins and files live. The default (`local`) keeps everything on disk and needs no setup at all, so you can safely not think about it until step 3.

If you've deployed a web app before, none of this will surprise you. If you haven't, the CLI in step 3 asks you a handful of questions and writes the config for you.

## 1. Rhino.Compute

This is the headless Rhino that does the actual solving once you're live. Use the [VektorNode fork](https://github.com/VektorNode/compute.rhino3d); it carries several changes Selva relies on, block instances among them.

One thing to watch: install Selva and any plugins your definitions rely on under the `rhino.compute` account. Plugins installed under a different user won't be there when Compute goes looking for them.

See [Rhino Compute Setup](../RhinoCompute.md).

## 2. Plugin + schema

1. Install **Selva** from the Grasshopper Package Manager.
2. Restart Rhino.
3. Drop the Selva UI Builder onto your definition and open the designer.
4. Drag inputs into controls, lay them out, save. The schema is written into the `.gh`.

Put that same `.gha` on the Compute server from step 1, otherwise the deployed app has no way to solve the definition.

## 3. Deploy the web app

```bash
npx @selvajs/cli my-deployment   # asks a few questions, writes the app folder
cd my-deployment
npm run doctor                   # checks the config before you start
npm start                        # runs it under pm2, which keeps it alive
```

`npx` fetches and runs the Selva command-line tool without installing it first. It'll ask which provider you want, what your site's URL is, and a few other things, then hand you a folder that's ready to run.

From there: open `/setup` to create the admin account (only works on first boot), register your Compute server at `/admin/compute`, upload a definition, and share the link. Backend choices live in the provider settings, see [Providers](../providers.md).

See [CLI](../CLI.md), [Local dev setup](../QuickStart.md), [Deployment prerequisites](../deployment/prerequisites.md).

## 4. (Optional) Build your own app

Want your own branding, domain features, or the viewer embedded in a larger product? Consume the `@selvajs/*` packages directly.

See [Build your own app](build-your-own-app.md).
