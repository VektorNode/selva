# A plain Ubuntu box with a static IP and nothing installed on it. Shares the
# project/region/zone of the app VM but none of its lifecycle — no startup
# script, no Caddy, no app. Set `scratch_vm_enabled = false` to destroy it
# without touching the app.

resource "google_compute_address" "scratch" {
  count  = var.scratch_vm_enabled ? 1 : 0
  name   = "selva-scratch-ip"
  region = var.region
}

resource "google_compute_firewall" "scratch_ssh" {
  count   = var.scratch_vm_enabled ? 1 : 0
  name    = "selva-scratch-allow-ssh"
  network = "default"

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["selva-scratch"]
}

resource "google_compute_instance" "scratch" {
  count        = var.scratch_vm_enabled ? 1 : 0
  name         = "selva-scratch"
  machine_type = var.scratch_machine_type
  zone         = var.zone

  # No http-server/https-server tags: nothing is listening, so nothing is open.
  tags = ["selva-scratch"]

  boot_disk {
    initialize_params {
      image = "ubuntu-os-cloud/ubuntu-2204-lts"
      size  = var.scratch_disk_size
      type  = "pd-standard"
    }
  }

  network_interface {
    network = "default"
    access_config {
      nat_ip = google_compute_address.scratch[0].address
    }
  }

  metadata = {
    ssh-keys = "${var.ssh_user}:${local.ssh_pub_key}"
  }

  service_account {
    scopes = ["cloud-platform"]
  }
}
