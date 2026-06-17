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
npx @selvajs/cli my-deployment   # prompts for provider, origin, tenancy, secrets
cd my-deployment
npm run doctor                   # validate config
npm start                        # pm2 start
```

Then: visit `/setup` to create the admin (first boot only), register your Compute server at `/admin/compute`, upload a definition, share the link. Pick your backend here via provider env vars; see [Providers](../providers.md).

See [CLI](../CLI.md), [Local dev setup](../QuickStart.md), [Linux deploy](../deployment/GCE-Linux.md).

## 4. (Optional) Build your own app

Want your own branding, domain features, or the viewer embedded in a larger product? Consume the `@selvajs/*` packages directly.

See [Build your own app](build-your-own-app.md).
