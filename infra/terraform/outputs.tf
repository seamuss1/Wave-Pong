output "backend_env_file" {
  description = "Generated backend env file for the selected environment."
  value       = local_file.backend_env.filename
}

output "runtime_env_file" {
  description = "Generated runtime-env.js file for the static browser client."
  value       = local_file.runtime_env.filename
}

output "control_plane_public_url" {
  description = "Resolved control-plane public URL."
  value       = trimsuffix(var.control_plane_public_url, "/")
}

output "control_plane_public_ws_url" {
  description = "Resolved control-plane WebSocket URL."
  value       = local.backend_env.WAVE_PONG_PUBLIC_CONTROL_WS_URL
}

output "match_worker_public_ws_url" {
  description = "Resolved match-worker public WebSocket URL."
  value       = trimsuffix(var.match_worker_public_ws_url, "/")
}
