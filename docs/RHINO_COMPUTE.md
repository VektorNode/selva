# Rhino Compute Server Setup Guide

This guide walks you through setting up a Rhino Compute server to enable cloud-based solving of Grasshopper definitions for Selva applications.

## Prerequisites

- Windows Server or VM instance (Azure, AWS, or on-premises)
- Administrator access
- Core Hour Billing account with API access

## Step 1: Set Up Billing and Core Hours

Before deploying Rhino Compute, you'll need to configure Core Hour Billing for your account.

1. Review the [Core Hour Billing guide](https://developer.rhino3d.com/guides/compute/core-hour-billing/)
2. Set up a Core Hour Billing account
3. Obtain your API credentials

## Step 2: Create or Prepare a Virtual Machine

Choose one of the following options to host your Rhino Compute server:

### Option A: Deploy on Azure

Follow the [Creating an Azure VM guide](https://developer.rhino3d.com/guides/compute/creating-an-azure-vm/) to create a Windows-based virtual machine.

### Option B: Deploy on AWS

Follow the [Creating an AWS VM guide](https://developer.rhino3d.com/guides/compute/creating-an-aws-vm/) to create a Windows-based virtual machine.

### Option C: On-Premises Windows Server

Use your own Windows Server hardware or virtual machine.

## Step 3: Install Rhino Compute

1. Follow the [Deploy to IIS guide](https://developer.rhino3d.com/guides/compute/deploy-to-iis/) to install and configure Rhino Compute on your server
2. Ensure IIS is properly configured with the Compute service running

## Step 4: Install Custom Rhino Compute Fork

After the standard Rhino Compute installation, deploy our custom fork to enable additional features:

1. Open PowerShell as Administrator
2. Run the update script:
   ```powershell
   # Download and execute the custom fork installer
   # Run from the VektorNode custom fork:
   https://github.com/VektorNode/compute.rhino3d/blob/5a25616a696fa687b0e572a38e09e5b6cc6bf327/script/update_compute_server/module_update_compute.ps1
   ```

This installs our custom fork of Rhino Compute with full capabilities support.

## Step 5: Enable Block Instances Support

To enable full Selva capabilities (including block instances), add the following environment variable:

1. Open Windows Environment Variables
2. Create or modify the `RHINO_COMPUTE_CREATE_HEADLESS_DOC` variable
3. Set its value to `true`
4. Restart the Rhino Compute service

## Step 6: Install Selva Plugin

Under the `rhino.compute` user account:

1. Open the Grasshopper Package Manager
2. Install the **Selva plugin**
3. Install any other plugins required by your Grasshopper definitions

This ensures that when solving definitions, all necessary plugins are available in the headless environment.

**Restart rhino/rhino.compute if already running**

## Maintenance: Updating Rhino Compute

To update your Rhino Compute server with the latest custom fork:

1. Open PowerShell as Administrator
2. Run the update script:
   ```powershell
   # Run the module update script from the VektorNode custom fork:
   https://github.com/VektorNode/compute.rhino3d/blob/5a25616a696fa687b0e572a38e09e5b6cc6bf327/script/update_compute_server/module_update_compute.ps1
   ```

The script will update Rhino Compute while preserving your existing configuration.

## Next Steps

Once your Rhino Compute server is running, you can configure your Selva compute-app to connect to it. Update your environment variables to point to your server's URL.
