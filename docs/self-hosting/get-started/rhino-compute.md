---
title: Rhino Compute Setup
order: 2
published: false
description: 'Stand up the headless Rhino that solves your definitions, using the VektorNode fork.'
---

# Rhino Compute Setup

This is the headless Rhino that does the actual solving once you're live. It runs on
its own Windows machine, separate from the app server.

## Prerequisites

- Windows Server or VM (Azure, AWS, or on-premises)
- A Rhino license: [Core Hour Billing](https://developer.rhino3d.com/guides/compute/core-hour-billing/), standalone, or Cloud Zoo

## Steps

1. **Create a VM.** [Azure](https://developer.rhino3d.com/guides/compute/creating-an-azure-vm/) · [AWS](https://developer.rhino3d.com/guides/compute/creating-an-aws-vm/) · or on-premises Windows Server.

2. **Install Rhino Compute.** Follow the [Deploy to IIS guide](https://developer.rhino3d.com/guides/compute/deploy-to-iis/).

3. **Install the VektorNode fork.** Open PowerShell as Administrator on the compute VM and run [`update_compute_selva.ps1`](https://github.com/VektorNode/compute.rhino3d/blob/8.x.selva/script/update_compute_server/update_compute_selva.ps1). The fork carries several changes Selva relies on, block instances and the `definition_not_cached` reply that makes pointer reuse safe among them.

   ```powershell
   irm https://raw.githubusercontent.com/VektorNode/compute.rhino3d/8.x.selva/script/update_compute_server/update_compute_selva.ps1 | iex
   ```

   The script takes no arguments. It downloads the latest `8.x.selva` build, stops the `RhinoComputeAppPool` app pool and the `Rhino.Compute` site, backs up the current deployment to `C:\RhinoComputeBackups\` (keeping the last five), swaps in the new `rhino.compute` and `compute.geometry` folders under `C:\inetpub\wwwroot\aspnet_client\system_web\4_0_30319\`, restarts IIS, and hits `http://localhost/healthcheck` to confirm. If anything fails it rolls back to the previous backup. Logs land in `C:\Logs\RhinoCompute\`.

4. **Enable block instances.** Set the env var `RHINO_COMPUTE_CREATE_HEADLESS_DOC=true` and restart the service.

5. **Install the Selva plugin.** Under the `rhino.compute` user account, open the Grasshopper Package Manager and install **Selva**, along with any other plugins your definitions need. Restart Rhino/Compute afterwards.

## Updating

Re-run [`update_compute_selva.ps1`](https://github.com/VektorNode/compute.rhino3d/blob/8.x.selva/script/update_compute_server/update_compute_selva.ps1) as Administrator. It always pulls the latest `8.x.selva` build and keeps a rollback backup, so updating is the same command as installing.

## Connecting

Register the server in Selva's admin dashboard at `/admin/compute` by entering its URL and an optional API key. The data provider persists this config, not env vars.
