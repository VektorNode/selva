# Rhino Compute Server Setup

Guide for setting up a Rhino.Compute server to enable cloud-based solving of Grasshopper definitions.

## Prerequisites

- Windows Server or VM (Azure, AWS, or on-premises)
- Administrator access
- [Core Hour Billing](https://developer.rhino3d.com/guides/compute/core-hour-billing/) account

## Steps

### 1. Create a Virtual Machine

Choose a platform:

- **Azure**: [Creating an Azure VM](https://developer.rhino3d.com/guides/compute/creating-an-azure-vm/)
- **AWS**: [Creating an AWS VM](https://developer.rhino3d.com/guides/compute/creating-an-aws-vm/)
- **On-premises**: Use your own Windows Server

### 2. Install Rhino Compute

Follow the [Deploy to IIS guide](https://developer.rhino3d.com/guides/compute/deploy-to-iis/) to install and configure Rhino Compute.

### 3. Install the Custom Fork

After standard installation, deploy the VektorNode custom fork:

1. Open PowerShell as Administrator
2. Run the update script from the [VektorNode compute fork](https://github.com/VektorNode/compute.rhino3d)

### 4. Enable Block Instances Support

Add this environment variable (required for full Selva capabilities):

- Variable: `RHINO_COMPUTE_CREATE_HEADLESS_DOC`
- Value: `true`

Restart the Rhino Compute service after adding it.

### 5. Install the Selva Plugin

Under the `rhino.compute` user account:

1. Open Grasshopper Package Manager
2. Install the **Selva plugin** and any other plugins your definitions require
3. Restart Rhino/Rhino.Compute

## Updating

To update your server with the latest custom fork, re-run the update script from the [VektorNode compute fork](https://github.com/VektorNode/compute.rhino3d) as Administrator.

## Next Steps

Update your Selva compute-app environment variables to point to your server's URL (`COMPUTE_SERVER_URL`).
