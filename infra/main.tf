terraform {
  required_version = ">= 1.5"
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

# Static external IP
resource "google_compute_address" "selva" {
  name   = "selva-compute-ip"
  region = var.region
}

# Effective domain: user-supplied if set, otherwise <dashed-ip>.sslip.io.
# sslip.io is a public wildcard DNS service — `1-2-3-4.sslip.io` always
# resolves to 1.2.3.4, so Let's Encrypt can issue a real cert without any
# manual DNS step.
locals {
  domain = var.domain != "" ? var.domain : "${replace(google_compute_address.selva.address, ".", "-")}.sslip.io"

  # gcloud-managed SSH public key. Created automatically the first time
  # you run `gcloud compute ssh`. Injecting it into instance metadata at
  # create time avoids the "publickey rejected" race after every VM
  # recreate (gcloud's metadata sync is best-effort).
  ssh_pub_key = file(pathexpand("~/.ssh/google_compute_engine.pub"))
}

# Firewall: only 80 (ACME HTTP-01 challenge + redirect) and 443 (HTTPS) are
# public. The app process binds to 127.0.0.1:3000 inside the VM — never
# reachable from the network. Caddy is the single ingress.
resource "google_compute_firewall" "selva_web" {
  name    = "selva-allow-web"
  network = "default"

  allow {
    protocol = "tcp"
    ports    = ["80", "443"]
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["selva-compute"]
}

resource "google_compute_firewall" "selva_ssh" {
  name    = "selva-allow-ssh"
  network = "default"

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["selva-compute"]
}

# VM instance
resource "google_compute_instance" "selva" {
  name         = "selva-compute-app"
  machine_type = var.machine_type
  zone         = var.zone

  tags = ["selva-compute", "http-server", "https-server"]

  boot_disk {
    initialize_params {
      image = "ubuntu-os-cloud/ubuntu-2204-lts"
      size  = 20
      type  = "pd-standard"
    }
  }

  network_interface {
    network = "default"
    access_config {
      nat_ip = google_compute_address.selva.address
    }
  }

  metadata = {
    ssh-keys = "${var.ssh_user}:${local.ssh_pub_key}"
  }

  metadata_startup_script = templatefile("${path.module}/startup.sh.tpl", {
    public_ip    = google_compute_address.selva.address
    ssh_user     = var.ssh_user
    domain       = local.domain
    acme_email   = var.acme_email != "" ? var.acme_email : "admin@${local.domain}"
    branch       = var.branch
    github_token = var.github_token
  })

  service_account {
    scopes = ["cloud-platform"]
  }
}
