# Selva's own Rhino.Compute VM, separate from Parafa's. Runbook: ../README.md.
# Every name carries var.name so it can share a GCP project with another Compute server.

terraform {
  required_version = ">= 1.5.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
  zone    = var.zone
}

variable "project_id" {
  description = "Your GCP project ID"
  type        = string
}

variable "name" {
  description = "Prefix of every resource, the network tag and the ssh alias"
  type        = string
  default     = "selva-compute"
}

variable "region" {
  description = "GCP region"
  type        = string
  default     = "europe-west6" # Zurich
}

variable "zone" {
  description = "GCP zone"
  type        = string
  default     = "europe-west6-a"
}

variable "machine_type" {
  description = "Must be x86: McNeel's arm64 Rhino packages lag months behind. Rhino bills per vCPU while a child runs."
  type        = string
  default     = "e2-standard-2" # 2 vCPU, 8 GB
}

variable "running" {
  description = "false stops the VM: no machine cost, only the disk and the reserved IP"
  type        = bool
  default     = true
}

variable "ssh_public_key_path" {
  description = "Public key installed for the deploy user"
  type        = string
  default     = "~/.ssh/google_compute_engine.pub"
}

variable "ssh_public_keys" {
  description = "Every deploy machine's public key, so an apply from one machine doesn't revoke another's."
  type        = list(string)
  default     = []
}

variable "ssh_allowed_ips" {
  description = "Source ranges allowed to reach SSH"
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "compute_client_ips" {
  description = "Public IPs allowed on port 6500. Clients in the same VPC use the internal URL and need no entry; anything listed talks plain HTTP over the internet."
  type        = list(string)
  default     = []
}

variable "public_https" {
  description = "Open 80 and 443 to everyone for the HTTPS proxy deploy-server.sh runs when DEPLOY_TLS_DOMAIN is set (80 answers Let's Encrypt's challenge)"
  type        = bool
  default     = false
}

locals {
  ssh_public_key = trimspace(file(pathexpand(var.ssh_public_key_path)))
  # Sorted so every machine renders the same metadata and a plan shows no drift.
  ssh_keys = sort(distinct(concat([local.ssh_public_key], [for k in var.ssh_public_keys : trimspace(k)])))
}

resource "google_compute_address" "compute_ip" {
  name   = "${var.name}-ip"
  region = var.region
}

resource "google_compute_firewall" "allow_compute" {
  count   = length(var.compute_client_ips) > 0 ? 1 : 0
  name    = "allow-${var.name}"
  network = "default"

  allow {
    protocol = "tcp"
    ports    = ["6500"]
  }

  source_ranges = var.compute_client_ips
  target_tags   = [var.name]
}

resource "google_compute_firewall" "allow_https" {
  count   = var.public_https ? 1 : 0
  name    = "allow-https-${var.name}"
  network = "default"

  allow {
    protocol = "tcp"
    ports    = ["80", "443"]
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = [var.name]
}

resource "google_compute_firewall" "allow_ssh" {
  name    = "allow-ssh-${var.name}"
  network = "default"

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }

  source_ranges = var.ssh_allowed_ips
  target_tags   = [var.name]
}

# No service account: the VM runs third-party plugins and needs no Google API.
resource "google_compute_instance" "compute" {
  name           = "${var.name}-server"
  machine_type   = var.machine_type
  zone           = var.zone
  tags           = [var.name]
  desired_status = var.running ? "RUNNING" : "TERMINATED"

  labels = {
    owner = "selva"
  }

  boot_disk {
    initialize_params {
      image = "ubuntu-os-cloud/ubuntu-2404-lts-amd64"
      size  = 30 # GB
      type  = "pd-ssd"
    }
  }

  network_interface {
    network = "default"
    access_config {
      nat_ip = google_compute_address.compute_ip.address
    }
  }

  metadata = {
    enable-oslogin = "FALSE"
    # The guest agent creates this user with passwordless sudo, which
    # deploy-server.sh needs to install Docker on the first deploy.
    ssh-keys = join("\n", [for k in local.ssh_keys : "deploy:${k}"])
  }

  allow_stopping_for_update = true
}

output "ssh_config" {
  description = "Add to ~/.ssh/config, then DEPLOY_HOST=<name> in infra/compute/.env"
  value       = <<-EOT
    Host ${var.name}
      HostName ${google_compute_address.compute_ip.address}
      User deploy
      IdentityFile ${trimsuffix(pathexpand(var.ssh_public_key_path), ".pub")}
  EOT
}

output "internal_url" {
  description = "Rhino.Compute URL for clients in the same VPC"
  value       = "http://${google_compute_instance.compute.network_interface[0].network_ip}:6500"
}

output "public_url" {
  description = "Rhino.Compute URL for the clients in compute_client_ips"
  value       = "http://${google_compute_address.compute_ip.address}:6500"
}

output "sslip_domain" {
  description = "A DNS name for the reserved IP, usable as DEPLOY_TLS_DOMAIN without a domain of your own"
  value       = "${replace(google_compute_address.compute_ip.address, ".", "-")}.sslip.io"
}
