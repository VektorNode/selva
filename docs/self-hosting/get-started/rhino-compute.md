---
title: Rhino Compute Setup
order: 2
published: true
description: 'Stand up the headless Rhino that solves your definitions, using the VektorNode fork.'
---

# Rhino Compute Setup

The headless Rhino that solves definitions, on a Windows machine separate from the app server. You need a Windows VM and a Rhino license ([Core Hour Billing](https://developer.rhino3d.com/guides/compute/core-hour-billing/), standalone, or Cloud Zoo).

1. **Create a VM.** [Azure](https://developer.rhino3d.com/guides/compute/creating-an-azure-vm/), [AWS](https://developer.rhino3d.com/guides/compute/creating-an-aws-vm/), or on-premises.

2. **Install Rhino Compute** with the [Deploy to IIS guide](https://developer.rhino3d.com/guides/compute/deploy-to-iis/).

3. **Install the VektorNode fork**, which adds block instances. In PowerShell as Administrator:

   ```powershell
   irm https://raw.githubusercontent.com/VektorNode/compute.rhino3d/8.x.selva/script/update_compute_server/update_compute_selva.ps1 | iex
   ```

   It backs up the current deployment, swaps in the latest build, restarts IIS, and rolls back on failure. Re-run it to update.

4. **Set environment variables** and restart the service:
   - `RHINO_COMPUTE_CREATE_HEADLESS_DOC=true` enables block instances. The `8.x.selva` branch already defaults to true; `9.x.selva` defaults to false.
   - `RHINO_COMPUTE_ABORT_ON_HANGUP=true` stops a solve whose caller hung up, so an abandoned slider solve doesn't block the next one. Only the fork's `9.x.state` branch reads it; `8.x.selva` and `9.x.selva` ignore it.

5. **Install the Selva plugin** under the `rhino.compute` user account, through the Grasshopper Package Manager, along with any other plugins your definitions need. Plugins installed as another user aren't found at solve time.

Then register the server at `/admin/compute` with its URL and an optional API key.
