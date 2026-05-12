output "static_ip" {
  description = "Static external IP — POINT YOUR A RECORD AT THIS BEFORE THE VM FINISHES BOOTING."
  value       = google_compute_address.selva.address
}

output "dns_instructions" {
  description = "Copy-paste DNS record to add at your registrar."
  value       = "A   ${var.domain}   →   ${google_compute_address.selva.address}"
}

output "ssh_command" {
  description = "SSH command to connect to the VM"
  value       = "ssh ${var.ssh_user}@${google_compute_address.selva.address}"
}

output "app_url" {
  description = "URL to access the compute app (resolves once DNS + ACME complete)."
  value       = "https://${var.domain}"
}

output "health_check" {
  description = "Health check URL"
  value       = "https://${var.domain}/api/health"
}

output "startup_log" {
  description = "Command to watch the startup log on the VM"
  value       = "ssh ${var.ssh_user}@${google_compute_address.selva.address} 'tail -f /var/log/selva-startup.log'"
}
