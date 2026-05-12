variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region"
  type        = string
  default     = "europe-west1"
}

variable "zone" {
  description = "GCP zone"
  type        = string
  default     = "europe-west1-d"
}

variable "machine_type" {
  description = "GCE machine type"
  type        = string
  default     = "e2-medium"
}

variable "ssh_user" {
  description = "SSH username for VM access (used as the Linux user that runs the app)"
  type        = string
  default     = "selva"
}

variable "domain" {
  description = <<-EOT
    Fully-qualified domain name for the app (e.g. "app.example.dev").
    Caddy will obtain a Let's Encrypt cert for this name on first boot, so
    the A record MUST point at the static IP this module creates BEFORE the
    VM finishes booting. Workflow:

      1. terraform apply  → outputs `static_ip`
      2. Create A record  `<domain>` → <static_ip>  at your DNS host
      3. Re-run apply, or let the VM retry ACME on its own

    Quick test option: use a wildcard DNS service like `sslip.io` —
    e.g. `domain = "34-142-50-7.sslip.io"` resolves to 34.142.50.7 with
    zero DNS setup. Fine for testing, not for production.
  EOT
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$", var.domain))
    error_message = "domain must be a valid lowercase FQDN (e.g. app.example.dev)."
  }
}

variable "acme_email" {
  description = "Email address Let's Encrypt sends cert-expiry notices to. Defaults to admin@<domain>."
  type        = string
  default     = ""
}

variable "branch" {
  description = <<-EOT
    Git branch / tag / commit to deploy. Defaults to main. Override to deploy
    a feature branch (e.g. "9x") — both the bootstrap scripts (setup.sh /
    setup-caddy.sh fetched via curl) and the cloned repo will use this ref.
  EOT
  type        = string
  default     = "main"
}

