# Terraform — GCP Deployment

Provisions a Google Cloud VM running the Selva Compute App with a static IP,
Caddy reverse proxy, and **automatic HTTPS via Let's Encrypt**.

## What gets created

| Resource | Details |
|---|---|
| Static external IP | Reserved, survives VM stop/start and recreations |
| Firewall rules | TCP 80 (ACME + redirect) and 443 (HTTPS) + 22 (SSH). The app on :3000 is firewalled and binds to `127.0.0.1` — never reachable directly. |
| VM instance | e2-medium, Ubuntu 22.04, 20GB disk |

On first boot the VM runs [`scripts/setup.sh`](../scripts/setup.sh) (app build
+ PM2) and [`scripts/setup-caddy.sh`](../scripts/setup-caddy.sh) (Caddy in
prod mode, which provisions a Let's Encrypt cert for your domain).

---

## Prerequisites

- [Terraform](https://developer.hashicorp.com/terraform/install) >= 1.5
- [gcloud CLI](https://cloud.google.com/sdk/docs/install) authenticated (`gcloud auth application-default login`)
- A GCP project with the Compute Engine API enabled
- A domain you control (`.dev`, `.xyz`, anything) — or use `sslip.io` for throwaway testing

---

## Setup

**1. Copy and fill in your variables:**

```bash
cp terraform.tfvars.example terraform.tfvars
```

Fill in at minimum:

```hcl
project_id = "your-gcp-project-id"
domain     = "app.example.dev"
acme_email = "you@example.dev"
```

Rhino.Compute server URL + API key are registered post-install via
`/admin/compute` (not Terraform). The first admin user is created
via the in-app setup page on first boot.

**2. Reserve the IP first, then point DNS:**

```bash
terraform apply -target=google_compute_address.selva
terraform output static_ip
```

Add an `A` record at your DNS host:

```
A   app.example.dev   →   <static_ip>
```

Wait until `dig +short app.example.dev` returns the IP (typically 1–5 min).

**3. Deploy the rest:**

```bash
terraform apply
```

Outputs include the app URL (`https://<domain>`), SSH command, and the
DNS instruction.

> **Why DNS first?** Let's Encrypt verifies you control the domain by
> hitting it over HTTP. If DNS doesn't resolve when Caddy first tries,
> ACME fails — Caddy will retry every few minutes on its own, but it's
> cleaner to have DNS ready up front.

### Testing without buying a domain

`sslip.io` provides wildcard DNS that maps any IP-shaped subdomain back
to that IP:

```hcl
# After `terraform apply -target=google_compute_address.selva`, plug the IP in:
domain = "34-142-50-7.sslip.io"
```

Caddy gets a real Let's Encrypt cert. Skip the manual DNS step entirely.
Fine for testing, not for production.

---

## After Deployment

Watch the bootstrap (deploy-key prompt + DNS check + ACME):

```bash
gcloud compute ssh selva@selva-compute-app --zone <zone> --project YOUR_PROJECT
tail -f /var/log/selva-startup.log
```

Verify:

```bash
curl https://YOUR-DOMAIN/api/health
```

If Caddy hasn't gotten a cert yet, `curl -k` will work and
`sudo journalctl -u caddy -f` shows the ACME retry loop.

---

## Add Your Grasshopper Definitions

```bash
gcloud compute scp your-definition.gh selva@selva-compute-app:~/selva/packages/compute-app/definitions/ --zone <zone>
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

| Issue | Fix |
|---|---|
| Zone out of capacity | Change `zone` in `terraform.tfvars` and re-apply |
| Startup script failed | SSH in: `cat /var/log/selva-startup.log` |
| App not responding | `pm2 status` and `pm2 logs selva-compute` |
| Caddy can't get a cert | `sudo journalctl -u caddy -f` — usually DNS hasn't propagated yet |
| `dig` returns the IP but cert still fails | Check that port 80 is open in the GCP firewall (ACME HTTP-01 uses it) |
| Want to expose :3000 directly | Don't. Caddy is the only ingress. Editing the firewall to open 3000 breaks the security model for forward-auth providers. |
