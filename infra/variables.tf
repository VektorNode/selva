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

variable "compute_server_url" {
  description = "URL of your Rhino.Compute server"
  type        = string
}

variable "compute_api_key" {
  description = "API key for Rhino.Compute"
  type        = string
  sensitive   = true
}

variable "admin_password" {
  description = "Admin panel password (optional)"
  type        = string
  default     = ""
  sensitive   = true
}

variable "admin_secret" {
  description = "Admin session secret, 32+ chars (optional)"
  type        = string
  default     = ""
  sensitive   = true
}
