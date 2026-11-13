---
title: Get Started Overview
order: 1
published: true
description: 'Three steps to a live deployment, plus the mental model for compute vs. app servers.'
---

# Get Started

Going live takes three steps on two machines: a Windows **Compute server** running headless Rhino, and an **app server** (any host that runs a long-lived Node process) that solves through it.

To try it first, [Local Dev Setup](./quick-start.md) runs the app on your laptop. Solving still needs a Compute server.

## 1. Rhino.Compute

Install the [VektorNode fork](https://github.com/VektorNode/compute.rhino3d), Selva, and your definitions' plugins, the last two **under the `rhino.compute` account**. See [Rhino Compute Setup](./rhino-compute.md).

## 2. Plugin + schema

1. Install **Selva** from the Grasshopper Package Manager and restart Rhino.
2. Drop the Selva UI Bridge onto your definition and open the designer.
3. Drag inputs into controls, lay them out, save. The schema is written into the `.gh`.

## 3. Deploy the web app

Run `npx @selvajs/cli my-deployment`, then `npm run doctor` and `npm start` from the new directory. The [CLI guide](./cli.md) has the details.

Open the setup link the scaffold printed (`npx selva setup-url` prints it again) to create the admin account, register your Compute server at `/admin/compute`, upload a definition, share the link. OAuth, email-link and proxy sign-ins need the link too, unless `BOOTSTRAP_INSTANCE_ADMIN_EMAIL` names the admin: then signing in with that address is enough.

Auth, data, and storage default to the `local` provider, which needs no setup. See [Providers](../providers/overview.md) and [Deployment prerequisites](../deployment/prerequisites.md).

## 4. (Optional) Build your own app

Use the `@selvajs/*` packages directly. See [Build your own app](../../packages/build/overview.md).
