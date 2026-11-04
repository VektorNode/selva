# Selva's Rhino.Compute server

Selva's own Compute VM, separate from Parafa's, so the two never share a server, its plugins or its
load. Every GCP resource is named `selva-compute-*` and labelled `owner=selva`. The image and
`deploy-server.sh` live in compute.rhino3d (`setup/README.md` › _Deploying to a server_); this folder
creates the machine and holds its deploy settings. The app VM is [../](../README.md).

Terraform state, `terraform.tfvars` and `.env` are gitignored and exist only on the machine that
created them.

## First time

Needs Terraform and Google application-default credentials (`gcloud auth application-default login`).

1. Create the VM:

   ```sh
   cd infra/compute/gcp
   cp terraform.tfvars.example terraform.tfvars   # set project_id, ssh_public_keys
   terraform init
   terraform apply
   terraform output -raw ssh_config >> ~/.ssh/config   # adds the selva-compute alias
   ```

2. `cp infra/compute/.env.example infra/compute/.env` and fill it in: `DEPLOY_TLS_DOMAIN` is the
   `sslip_domain` output; `RHINO_TOKEN` and `SERVER_RHINO_COMPUTE_KEY` are this server's own. Selva
   ships as this repo's Rhino 9 build (`Plugin/Selva.GH/bin/Release/net10.0`), rebuilt by each
   deploy, not from Yak; [packages.json](packages.json) lists no Yak packages so the server can't
   load a second copy. With compute.rhino3d checked out next to this repo on its pushed `9.x.selva`:

   ```sh
   pnpm run compute:deploy          # also: status | logs | ssh
   ```

   The first deploy installs Docker and builds the image, which takes several minutes.

3. Point Selva at it: `https://` plus the `sslip_domain` output, with the same key, in the app's
   Compute settings or `RHINO_COMPUTE_URL` / `RHINO_COMPUTE_KEY`.

## Day to day

`terraform apply -var running=false` stops the VM (it then bills only its disk and reserved IP);
`-var running=true` starts it. Every deploy is `pnpm run compute:deploy`. `terraform destroy` removes it.
