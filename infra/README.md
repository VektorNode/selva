# Terraform — GCP Deployment

Provisions a Google Cloud VM running the Selva Compute App with a static IP and Caddy reverse proxy.

## What gets created

| Resource | Details |
|---|---|
| Static external IP | Reserved, survives VM recreations |
| Firewall rules | TCP 80, 443 (web) + 22 (SSH) |
| VM instance | e2-medium, Ubuntu 22.04, 20GB disk |

The VM runs [`scripts/setup.sh`](../scripts/setup.sh) on first boot, which installs Node.js, pnpm, PM2, builds the app, and starts Caddy on port 80.

---

## Prerequisites

- [Terraform](https://developer.hashicorp.com/terraform/install) >= 1.5
- [gcloud CLI](https://cloud.google.com/sdk/docs/install) authenticated (`gcloud auth application-default login`)
- A GCP project with the Compute Engine API enabled

---

## Setup

**1. Copy and fill in your variables:**

```bash
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars`:

```hcl
project_id         = "your-gcp-project-id"
region             = "europe-west6"
zone               = "europe-west6-a"
compute_server_url = "http://your-compute-server"
compute_api_key    = "your-api-key"
admin_password     = "your-password"
admin_secret       = "your-32-char-secret"
```

**2. Deploy:**

```bash
terraform init
terraform plan
terraform apply
```

Outputs include the static IP, app URL, and SSH command.

---

## After Deployment

The VM runs `setup.sh` automatically on first boot. Watch the progress:

```bash
gcloud compute ssh selva@selva-compute-app --zone europe-west6-a --project YOUR_PROJECT
tail -f /var/log/selva-startup.log
```

Once complete, verify:

```bash
curl http://YOUR-IP/api/health
```

---

## Add Your Grasshopper Definitions

Copy `.gh` files to the VM:

```bash
gcloud compute scp your-definition.gh selva@selva-compute-app:~/selva/packages/compute-app/definitions/ --zone europe-west6-a
```

Then access the app at:

```
http://YOUR-IP/app?gh=your-definition
```

---

## Updating the App

SSH into the VM and run:

```bash
bash ~/selva/scripts/update.sh
```

---

## Destroying

```bash
terraform destroy
```

This deletes the VM, firewall rules, and static IP.

---

## Troubleshooting

| Issue | Fix |
|---|---|
| Zone out of capacity | Change `zone` in `terraform.tfvars` and re-apply |
| Startup script failed | SSH in and check `cat /var/log/selva-startup.log` |
| App not responding | SSH in and run `pm2 status` and `pm2 logs selva-compute` |
| Caddy not running | SSH in and run `sudo systemctl status caddy` |
