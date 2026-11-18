# Windows Rhino.Compute on Azure

For definitions that need Windows-only Grasshopper plugins. Rhino 8, the VektorNode fork's `8.x.selva`
Rhino.Compute, under IIS. The Linux server in [../gcp](../gcp) stays the default when every plugin runs there.

[setup.ps1](setup.ps1) runs on the VM: it installs the fork's latest `8.x.selva` CI build, runs the fork's
`bootstrap.ps1` (Rhino, IIS, the `RhinoComputeUser` app pool), installs [plugins.json](plugins.example.json)
into that user's profile, and gets a Let's Encrypt certificate for the VM's Azure DNS name.

## First time

Needs Terraform and `az login`.

```powershell
cd infra/compute/azure
cp terraform.tfvars.example terraform.tfvars   # subscription_id, rdp_allowed_ips
cp .env.example .env                           # RHINO_TOKEN, RHINO_COMPUTE_KEY, EMAIL_ADDRESS
cp plugins.example.json plugins.json           # this server's plugins; local files go in plugins/
terraform init
terraform apply
pwsh ./deploy.ps1
```

The first deploy takes 30 to 60 minutes. Then set `compute_url` (`terraform output compute_url`) and
`RHINO_COMPUTE_KEY` in Selva's Compute settings.

## Day to day

- Plugins changed or the fork's branch pushed: `pwsh ./deploy.ps1`. A Yak package reinstalls only when its
  version changes; local files are copied every time.
- Stop billing for the machine: `az vm deallocate -g selva-compute-win-rg -n selva-compute-win-vm`, and
  `az vm start` to resume. The disk and the static IP keep billing.
- RDP: `terraform output rdp`. Plugins live in `C:\Users\RhinoComputeUser\AppData\Roaming`.
- Don't run the bootstrap's `update.ps1` without `-SkipCompute`: it would swap the fork's build for McNeel's.
- `terraform destroy` removes everything.
