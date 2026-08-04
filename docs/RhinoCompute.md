---
title: Rhino Compute Setup
group: Get Started
order: 2
published: true
description: 'Stand up the headless Rhino that solves your definitions, using the VektorNode fork.'
---

# Rhino Compute Setup

This is the headless Rhino that does the actual solving once you're live. It runs on
its own Windows machine, separate from the app server.

## Prerequisites

- Windows Server or VM (Azure, AWS, or on-premises)
- A Rhino license — [Core Hour Billing](https://developer.rhino3d.com/guides/compute/core-hour-billing/), standalone, or Cloud Zoo

## Steps

1. **Create a VM** — [Azure](https://developer.rhino3d.com/guides/compute/creating-an-azure-vm/) · [AWS](https://developer.rhino3d.com/guides/compute/creating-an-aws-vm/) · or on-premises Windows Server.

2. **Install Rhino Compute** — follow the [Deploy to IIS guide](https://developer.rhino3d.com/guides/compute/deploy-to-iis/).

3. **Install the VektorNode fork** — open PowerShell as Administrator and run the update script from [VektorNode/compute.rhino3d](https://github.com/VektorNode/compute.rhino3d). The fork adds block-instance support, which the stock build lacks.

4. **Enable block instances** — set the env var `RHINO_COMPUTE_CREATE_HEADLESS_DOC=true` and restart the service.

5. **Install the Selva plugin** — under the `rhino.compute` user account, open the Grasshopper Package Manager and install **Selva**, along with any other plugins your definitions need. Restart Rhino/Compute afterwards.

## Updating

Re-run the update script from [VektorNode/compute.rhino3d](https://github.com/VektorNode/compute.rhino3d) as Administrator.

## Connecting

Register the server in Selva's admin dashboard at `/admin/compute` by entering its URL and an optional API key. The data provider persists this config, not env vars.
