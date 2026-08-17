output "static_ip" {
  description = "Static external IP reserved for the VM."
  value       = google_compute_address.selva.address
}

output "domain" {
  description = "Effective domain (user-supplied, or auto-derived sslip.io)."
  value       = local.domain
}

output "dns_instructions" {
  description = "DNS record to add at your registrar. Empty when using sslip.io (no DNS setup needed)."
  value       = var.domain == "" ? "(using sslip.io — no DNS setup needed)" : "A   ${var.domain}   →   ${google_compute_address.selva.address}"
}

output "ssh_command" {
  description = "SSH command to connect to the VM"
  value       = "ssh ${var.ssh_user}@${google_compute_address.selva.address}"
}

output "app_url" {
  description = "URL to access the compute app (resolves once ACME completes — usually 1–2 min after boot)."
  value       = "https://${local.domain}"
}

output "health_check" {
  description = "Health check URL"
  value       = "https://${local.domain}/api/health"
}

output "scratch_ip" {
  description = "Static external IP of the scratch VM. Null when scratch_vm_enabled = false."
  value       = var.scratch_vm_enabled ? google_compute_address.scratch[0].address : null
}

output "scratch_ssh_command" {
  description = "SSH command for the scratch VM. Null when scratch_vm_enabled = false."
  value       = var.scratch_vm_enabled ? "ssh ${var.ssh_user}@${google_compute_address.scratch[0].address}" : null
}

output "startup_log" {
  description = "Command to watch the startup log on the VM"
  value       = "ssh ${var.ssh_user}@${google_compute_address.selva.address} 'tail -f /var/log/selva-startup.log'"
}
