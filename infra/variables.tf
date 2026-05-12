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

    Leave empty (the default) and the module derives a free sslip.io
    domain from the reserved static IP — e.g. `34-142-50-7.sslip.io`.
    Caddy still gets a real Let's Encrypt cert. Fine for testing; not
    for production (you don't own sslip.io).

    For a real domain: set this, run `terraform apply`, then create an
    A record `<domain> → <static_ip>` at your DNS host. Caddy retries
    ACME every few minutes, so DNS doesn't have to be ready at boot.
  EOT
  type        = string
  default     = ""

  validation {
    condition     = var.domain == "" || can(regex("^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$", var.domain))
    error_message = "domain must be empty (for sslip.io auto-derivation) or a valid lowercase FQDN (e.g. app.example.dev)."
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

variable "github_token" {
  description = <<-EOT
    GitHub personal access token used to fetch setup scripts from the
    private VektorNode/selva repo over the raw.githubusercontent.com API.
    Use a fine-grained PAT scoped to only this repo with read-only Contents
    permission. The token is rendered into the VM's startup script (visible
    in instance metadata) and stored in Terraform state.

    The deploy key on the VM is still used for the actual `git clone` —
    this token only covers the two raw-file fetches in the bootstrap.
  EOT
  type        = string
  sensitive   = true
}

