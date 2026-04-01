output "static_ip" {
  description = "Static external IP address of the VM"
  value       = google_compute_address.selva.address
}

output "ssh_command" {
  description = "SSH command to connect to the VM"
  value       = "ssh ${var.ssh_user}@${google_compute_address.selva.address}"
}

output "app_url" {
  description = "URL to access the compute app"
  value       = "http://${google_compute_address.selva.address}/app?gh=your-definition"
}

output "health_check" {
  description = "Health check URL"
  value       = "http://${google_compute_address.selva.address}/api/health"
}

output "startup_log" {
  description = "Command to watch the startup log on the VM"
  value       = "ssh ${var.ssh_user}@${google_compute_address.selva.address} 'tail -f /var/log/selva-startup.log'"
}
