# Selva's Rhino.Compute server on Azure

The same Rhino 9 Linux server as [../gcp](../README.md), on Azure, with SheepMetal and Selva Canopy from
Yak ([packages.json](packages.json)) and Selva as this repo's build. Named `selva-compute-az-*`, tagged
`owner=selva`.

## First time

Needs Terraform and `az login`.

1. Create the VM:

   ```sh
   cd infra/compute/azure
   cp terraform.tfvars.example terraform.tfvars   # subscription_id, ssh_allowed_ips
   terraform init
   terraform apply
   terraform output -raw ssh_config >> ~/.ssh/config   # adds the selva-compute-az alias
   ```

2. `cp .env.example .env` and fill it in: `DEPLOY_TLS_DOMAIN` is the `tls_domain` output. With
   compute.rhino3d checked out next to this repo on its pushed `9.x.selva`, from the repo root:

   ```sh
   COMPUTE_ENV=infra/compute/azure/.env pnpm run compute:deploy   # also: status | logs | ssh
   ```

3. Point Selva at `https://` plus the `tls_domain` output, with `SERVER_RHINO_COMPUTE_KEY`.

## Day to day

`az vm deallocate -g selva-compute-az-rg -n selva-compute-az-vm` stops the machine bill (the disk and the
static IP keep billing); `az vm start` resumes. `terraform destroy` removes it.
