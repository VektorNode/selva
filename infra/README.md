# Terraform — GCP Deployment

Provisions a Google Cloud VM running the Selva Compute App with a static IP,
Caddy reverse proxy, and **automatic HTTPS via Let's Encrypt**.

The VM installs the published `@selvajs/selva` runtime from npm via
`@selvajs/cli` — no git clone, no source build, no GitHub PAT.

## What gets created

| Resource           | Details                                                                                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Static external IP | Reserved, survives VM stop/start and recreations                                                                                         |
| Firewall rules     | TCP 80 (ACME + redirect) and 443 (HTTPS) + 22 (SSH). The app on :3000 is firewalled and binds to `127.0.0.1` — never reachable directly. |
| VM instance        | e2-medium, Ubuntu 22.04, 20GB disk                                                                                                       |

On first boot the VM:

1. Installs Node.js 20 from NodeSource.
2. Runs `npx @selvajs/cli@latest . --yes` as the `ssh_user`. The CLI
   reads its config from environment variables Terraform set
   (`SELVA_AUTH_PROVIDER`, `ORIGIN`, `BOOTSTRAP_INSTANCE_ADMIN_EMAIL`, …)
   and writes `.env`, `selva.config.js`, and `ecosystem.config.cjs`.
3. `npm start` boots the app under PM2 (resolved from the deployment's
   own `node_modules/.bin/pm2`).
4. Installs Caddy and writes a Caddyfile proxying `https://<domain>` →
   `127.0.0.1:3000` with a Let's Encrypt cert.

---

## Prerequisites

- [Terraform](https://developer.hashicorp.com/terraform/install) >= 1.5
- [gcloud CLI](https://cloud.google.com/sdk/docs/install) authenticated (`gcloud auth application-default login`)
- A GCP project with the Compute Engine API enabled
- A domain you control — or skip it and let the module derive `<ip>.sslip.io`

No GitHub PAT, no SSH deploy key. The CLI fetches everything from the
public npm registry.

---

## Setup

### 1. Fill in `terraform.tfvars`

```bash
cp terraform.tfvars.example terraform.tfvars
```

Minimum:

```hcl
project_id = "your-gcp-project-id"
```

That alone gives you a single-tenant deployment with the local provider,
behind Caddy, on a free sslip.io domain. To customise:

```hcl
# Use a real domain (add the A record after apply).
domain     = "app.example.dev"
acme_email = "you@example.dev"

# Or change the deployment shape.
auth_provider         = "supabase"
supabase_url          = "https://<ref>.supabase.co"
supabase_anon_key     = "sb_publishable_…"
supabase_service_role_key = "…"

# Or stand up a multi-tenant SaaS instance.
tenancy               = "multi"
bootstrap_admin_email = "you@your-org.com"
```

See [variables.tf](variables.tf) for the full list. Rhino.Compute server URL

- API key are registered post-install via `/admin/compute` (not Terraform).
  The first admin user is created via the in-app setup page on first boot
  (single-tenant) or claimed by `bootstrap_admin_email` (multi / header-auth).

### 2. Deploy

```bash
terraform apply
```

Outputs include the app URL, SSH command, and the resolved domain.
The VM bootstrap takes 1–3 minutes (`npm install` of the prebuilt
runtime + providers; no compile step). Caddy provisions the cert as
soon as the app is up and DNS resolves.

### Using your own domain

Set `domain` and `acme_email` in `terraform.tfvars`. After `terraform apply`,
add an A record at your DNS host:

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

Upload via the admin UI at `https://YOUR-DOMAIN/admin/definitions`, or
scp into the data directory:

```bash
gcloud compute scp your-definition.gh \
  selva@selva-compute-app:~/selva/.selva-data/definitions/ \
  --zone <zone>
```

Access:

```
https://YOUR-DOMAIN/app?gh=your-definition
```

---

## Updating the App

The deployment's `package.json` has `update` wired to the CLI:

```bash
gcloud compute ssh selva@selva-compute-app --zone <zone>
cd ~/selva && npm run update
```

`selva update` runs `npm update @selvajs/*` then `pm2 restart --update-env`.
The admin-center "Run Update" button does the same thing. See
[docs/Hotfix-CLI-Runtime.md](../docs/Hotfix-CLI-Runtime.md) for the
stale-packument-cache trap if `update` reports the same version twice.

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

| Issue                                                          | Fix                                                                                                                                           |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Zone out of capacity                                           | Change `zone` in `terraform.tfvars` (e.g. `europe-west1-b`) and re-apply                                                                      |
| `gcloud compute ssh`: "publickey rejected"                     | Run `gcloud compute ssh` once to any VM to generate `~/.ssh/google_compute_engine.pub`; Terraform reads it on apply.                          |
| Startup log shows "BOOTSTRAP_INSTANCE_ADMIN_EMAIL is required" | You set `tenancy = "multi"` or `auth_provider = "header"` without `bootstrap_admin_email`. Fix the tfvar and re-apply.                        |
| Startup log shows "SUPABASE_URL is required"                   | A supabase provider is selected but the supabase tfvars are empty. Set them or switch back to `local`.                                        |
| Startup failed mid-way                                         | SSH in: `sudo cat /var/log/selva-startup.log`. Re-run the userland half manually: `sudo -u selva -H bash -c 'cd ~/selva && npm install'`.     |
| `selva update` says "Current = New" twice                      | Stale npm packument cache on the VM. See [docs/Hotfix-CLI-Runtime.md](../docs/Hotfix-CLI-Runtime.md) — `npm cache clean --force` + reinstall. |
| App not responding                                             | `cd ~/selva && ./node_modules/.bin/pm2 status && ./node_modules/.bin/pm2 logs selva-compute`                                                  |
| Caddy can't get a cert                                         | `sudo journalctl -u caddy -f` — usually DNS hasn't propagated yet                                                                             |
| Want to expose :3000 directly                                  | Don't. Caddy is the only ingress. Editing the firewall to open 3000 breaks the security model for forward-auth providers.                     |
