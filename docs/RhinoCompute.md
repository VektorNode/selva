---
title: Rhino Compute
group: Guides
order: 2
published: true
---

# Rhino Compute Setup

## Prerequisites

- Windows Server or VM (Azure, AWS, or on-premises)
- A Rhino license — [Core Hour Billing](https://developer.rhino3d.com/guides/compute/core-hour-billing/), standalone, or Cloud Zoo

## Steps

1. **Create a VM** — [Azure](https://developer.rhino3d.com/guides/compute/creating-an-azure-vm/) · [AWS](https://developer.rhino3d.com/guides/compute/creating-an-aws-vm/) · or on-premises Windows Server.

2. **Install Rhino Compute** — follow the [Deploy to IIS guide](https://developer.rhino3d.com/guides/compute/deploy-to-iis/).

3. **Install the VektorNode fork** — open PowerShell as Administrator and run the update script from [VektorNode/compute.rhino3d](https://github.com/VektorNode/compute.rhino3d).

4. **Enable block instances** — set env var `RHINO_COMPUTE_CREATE_HEADLESS_DOC=true` and restart the service.

5. **Install the Selva plugin** — under the `rhino.compute` user account, open the Grasshopper Package Manager, install **Selva** (and any other plugins your definitions need), then restart Rhino/Compute.

## Updating

Re-run the update script from [VektorNode/compute.rhino3d](https://github.com/VektorNode/compute.rhino3d) as Administrator.

## Connecting

Register the server in Selva's admin dashboard at `/admin/compute` — enter the URL and optional API key. Config is persisted via the data provider, not env vars.
