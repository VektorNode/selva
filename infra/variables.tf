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

# ============================================================================
# Selva CLI configuration
#
# These are read by @selvajs/cli's non-interactive mode
# (packages/cli/src/prompts.js → collectConfigFromEnv) on first boot. The
# defaults reproduce the prompt's "single-tenant, local provider" default —
# enough for a working deploy with zero extra config. Override any of them
# to scaffold a different shape.
# ============================================================================

variable "tenancy" {
  description = "Tenancy mode. `single` = one org per deployment (white-label); `multi` = orgs first-class (SaaS-style)."
  type        = string
  default     = "single"
  validation {
    condition     = contains(["single", "multi"], var.tenancy)
    error_message = "tenancy must be \"single\" or \"multi\"."
  }
}

variable "auth_provider" {
  description = "Auth backend. `local` = filesystem + HMAC sessions; `supabase` = managed auth; `header` = forward-auth via the reverse proxy."
  type        = string
  default     = "local"
  validation {
    condition     = contains(["local", "supabase", "header"], var.auth_provider)
    error_message = "auth_provider must be \"local\", \"supabase\", or \"header\"."
  }
}

variable "data_provider" {
  description = "Data backend. Empty means \"use auth_provider\" (header-auth defaults to local)."
  type        = string
  default     = ""
  validation {
    condition     = var.data_provider == "" || contains(["local", "supabase"], var.data_provider)
    error_message = "data_provider must be empty, \"local\", or \"supabase\"."
  }
}

variable "storage_provider" {
  description = "Storage backend. Empty means \"use auth_provider\" (header-auth defaults to local)."
  type        = string
  default     = ""
  validation {
    condition     = var.storage_provider == "" || contains(["local", "supabase"], var.storage_provider)
    error_message = "storage_provider must be empty, \"local\", or \"supabase\"."
  }
}

variable "bootstrap_admin_email" {
  description = <<-EOT
    Email of the user who becomes instance admin on first signup. REQUIRED
    when auth_provider = "header" or tenancy = "multi" — without it, header-auth
    has no way to claim admin (no /setup form), and a multi-tenant signup
    page hands staff perms to the first random visitor.

    Optional for single-tenant local auth; the first user to complete /setup
    becomes admin regardless.
  EOT
  type        = string
  default     = ""
}

variable "supabase_url" {
  description = "Supabase project URL. Required when any provider is \"supabase\"."
  type        = string
  default     = ""
}

variable "supabase_anon_key" {
  description = "Supabase publishable (anon) key. Required when any provider is \"supabase\"."
  type        = string
  default     = ""
}

variable "supabase_service_role_key" {
  description = "Supabase service role key — secret. Required when any provider is \"supabase\". Stored in Terraform state."
  type        = string
  default     = ""
  sensitive   = true
}
