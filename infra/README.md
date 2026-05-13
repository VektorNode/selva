# Terraform — GCP Deployment

Provisions a Google Cloud VM running the Selva Compute App with a static IP,
Caddy reverse proxy, and **automatic HTTPS via Let's Encrypt**.

## What gets created

| Resource           | Details                                                                                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Static external IP | Reserved, survives VM stop/start and recreations                                                                                         |
| Firewall rules     | TCP 80 (ACME + redirect) and 443 (HTTPS) + 22 (SSH). The app on :3000 is firewalled and binds to `127.0.0.1` — never reachable directly. |
| VM instance        | e2-medium, Ubuntu 22.04, 20GB disk                                                                                                       |

On first boot the VM runs [`scripts/setup.sh`](../scripts/setup.sh) (clones the
repo, builds the app, starts it under PM2) and
[`scripts/setup-caddy.sh`](../scripts/setup-caddy.sh) (Caddy in prod mode,
which provisions a Let's Encrypt cert for your domain). Both scripts are
fetched from the private `VektorNode/selva` repo via the GitHub Contents API,
authenticated with a PAT.

---

## Prerequisites

- [Terraform](https://developer.hashicorp.com/terraform/install) >= 1.5
- [gcloud CLI](https://cloud.google.com/sdk/docs/install) authenticated (`gcloud auth application-default login`)
- A GCP project with the Compute Engine API enabled
- A **GitHub fine-grained PAT** with read access to `VektorNode/selva` (see below)
- A domain you control — or skip it and let the module derive `<ip>.sslip.io`

---

## Setup

### 1. Create a GitHub PAT

The VM needs to fetch the bootstrap scripts and clone the repo. Deploy keys
are disabled at the VektorNode org level, so we use a PAT for both.

1. Open [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new)
2. **Resource owner**: `VektorNode` (an org admin may need to approve the token afterwards at [VektorNode → PAT requests](https://github.com/organizations/VektorNode/settings/personal-access-tokens-requests))
3. **Repository access**: Only select repositories → `VektorNode/selva`
4. **Repository permissions** → **Contents**: Read-only
5. **Expiration**: 90 days is fine (only used at VM boot)
6. Generate and copy the `github_pat_…` token

### 2. Fill in `terraform.tfvars`

```bash
cp terraform.tfvars.example terraform.tfvars
```

At minimum:

```hcl
project_id   = "your-gcp-project-id"
github_token = "github_pat_…"
```

Leave `domain` unset for testing — the module auto-derives a free
`<dashed-ip>.sslip.io` domain from the reserved static IP and Caddy
gets a real Let's Encrypt cert. No DNS setup required.

Rhino.Compute server URL + API key are registered post-install via
`/admin/compute` (not Terraform). The first admin user is created
via the in-app setup page on first boot.

### 3. Deploy

```bash
terraform apply
```

Outputs include the app URL, SSH command, and the resolved domain.
The VM bootstrap takes 3–8 minutes (apt installs + pnpm + build);
Caddy provisions the cert as soon as the app is up and DNS resolves.

### Using your own domain

Set `domain` and `acme_email` in `terraform.tfvars`:

```hcl
domain     = "app.example.dev"
acme_email = "you@example.dev"
```

After `terraform apply`, add an A record at your DNS host:

```
A   app.example.dev   →   <static_ip>     # from `terraform output static_ip`
```

Caddy retries ACME every few minutes, so DNS doesn't have to be ready
when the VM boots — but the cert will only land once DNS resolves.

---

## After Deployment

Watch the bootstrap:

```bash
gcloud compute ssh selva@selva-compute-app --zone <zone> \
  --command 'sudo tail -f /var/log/selva-startup.log'
```

You're done when you see `=== Selva startup script complete ===`.

Verify:

```bash
curl https://YOUR-DOMAIN/api/health
```

If Caddy hasn't gotten a cert yet, `curl -k` will work and
`sudo journalctl -u caddy -f` shows the ACME retry loop.

---

## Add Your Grasshopper Definitions

```bash
gcloud compute scp your-definition.gh selva@selva-compute-app:~/selva/packages/selva/definitions/ --zone <zone>
```

Access:

```
https://YOUR-DOMAIN/app?gh=your-definition
```

---

## Updating the App

```bash
gcloud compute ssh selva@selva-compute-app --zone <zone>
bash ~/selva/scripts/update.sh
```

---

## Start / Stop / SSH

The static IP is reserved, so stopping the VM is safe — the IP and DNS
record both survive.

```bash
# Start
gcloud compute instances start selva-compute-app --zone <zone>

# SSH (user is "selva")
gcloud compute ssh selva@selva-compute-app --zone <zone>

# Stop
gcloud compute instances stop selva-compute-app --zone <zone>
```

---

## Destroying

```bash
terraform destroy
```

Deletes the VM, firewall rules, and static IP. Your DNS record stays —
remove it manually if you're done.

---

## Troubleshooting

| Issue                                                                                | Fix                                                                                                                                                       |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zone out of capacity                                                                 | Change `zone` in `terraform.tfvars` (e.g. `europe-west1-b`) and re-apply                                                                                  |
| `gcloud compute ssh`: "No supported authentication methods (server sent: publickey)" | Make sure `~/.ssh/google_compute_engine.pub` exists (run `gcloud compute ssh` once to any VM — it'll generate the key). Terraform reads it on `apply` and bakes it into the VM's metadata. If the file is missing, `terraform plan` will error. |
| Plink "POTENTIAL SECURITY BREACH" host-key warning                                   | Expected after VM recreate (new host key). Type `y` to accept.                                                                                            |
| `curl … contents/scripts/setup.sh` returns 404                                       | PAT can't see the repo. Check it's approved at [VektorNode PAT requests](https://github.com/organizations/VektorNode/settings/personal-access-tokens-requests) and scoped to `VektorNode/selva` with Contents:read. |
| Startup script failed mid-way                                                        | SSH in: `sudo cat /var/log/selva-startup.log`. Re-run manually: `sudo bash /opt/selva-setup.sh`                                                           |
| App not responding                                                                   | `pm2 status` and `pm2 logs selva-compute`                                                                                                                 |
| Caddy can't get a cert                                                               | `sudo journalctl -u caddy -f` — usually DNS hasn't propagated yet                                                                                         |
| DNS resolves but cert still fails                                                    | Check port 80 is open in the GCP firewall (ACME HTTP-01 uses it)                                                                                          |
| Want to expose :3000 directly                                                        | Don't. Caddy is the only ingress. Editing the firewall to open 3000 breaks the security model for forward-auth providers.                                 |
