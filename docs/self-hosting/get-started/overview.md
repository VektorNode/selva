---
title: Get Started Overview
order: 1
published: true
description: 'Three steps to a live deployment, plus the mental model for compute vs. app servers.'
---

# Get Started

Going live takes three steps, plus an optional fourth if you want to build your own app around Selva.

Two machines are involved:

- **A Compute server** — a Windows machine running headless Rhino, which solves definitions on request. Step 1.
- **An app server** — any host that can run a long-lived Node process. Step 3.

To try it without renting anything, [Local Dev Setup](./quick-start.md) runs the app on your laptop. Solving still needs a Compute server.

## 1. Rhino.Compute

Use the [VektorNode fork](https://github.com/VektorNode/compute.rhino3d) — it carries changes Selva relies on, block instances among them.

Install Selva and any plugins your definitions need **under the `rhino.compute` account**. Plugins installed as a different user aren't found at solve time.

See [Rhino Compute Setup](./rhino-compute.md).

## 2. Plugin + schema

1. Install **Selva** from the Grasshopper Package Manager, then restart Rhino.
2. Drop the Selva UI Builder onto your definition and open the designer.
3. Drag inputs into controls, lay them out, save. The schema is written into the `.gh`.

Put the same `.gha` on the Compute server from step 1, or the deployed app can't solve the definition.

## 3. Deploy the web app

```bash
npx @selvajs/cli my-deployment   # prompts for provider, origin, tenancy; writes the app folder
cd my-deployment
npm run doctor                   # validates the config before starting
npm start                        # runs under pm2
```

Then: open `/setup` to create the admin account (first boot only), register your Compute server at `/admin/compute`, upload a definition, share the link.

Auth, data, and storage backends are pluggable — each defaults to `local`, which needs no setup. See [Providers](../providers/overview.md).

See [CLI](./cli.md), [Local dev setup](./quick-start.md), [Deployment prerequisites](../deployment/prerequisites.md).

## 4. (Optional) Build your own app

Consume the `@selvajs/*` packages directly to embed the viewer in your own product.

See [Build your own app](../../packages/build/overview.md).
