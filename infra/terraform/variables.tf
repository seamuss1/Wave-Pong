variable "environment" {
  description = "Deployment environment name, such as dev or prod."
  type        = string
}

variable "app_name" {
  description = "Base application name used in generated artifacts."
  type        = string
  default     = "wave-pong"
}

variable "control_plane_public_url" {
  description = "Public HTTPS URL for the control-plane service."
  type        = string
}

variable "match_worker_public_ws_url" {
  description = "Public WSS URL for the match-worker service."
  type        = string
}

variable "match_worker_internal_ws_url" {
  description = "Internal service-to-service WebSocket URL for the match-worker."
  type        = string
}

variable "static_client_origin" {
  description = "Origin serving the browser-only static client."
  type        = string
}

variable "database_url" {
  description = "Postgres connection string for control-plane persistence."
  type        = string
  sensitive   = true
}

variable "redis_url" {
  description = "Redis connection string for queues, presence, and tickets."
  type        = string
  sensitive   = true
}

variable "wave_pong_secret" {
  description = "Shared secret used to mint and verify session and match tokens."
  type        = string
  sensitive   = true
}

variable "control_port" {
  description = "Listen port for the control-plane process."
  type        = number
  default     = 8787
}

variable "worker_port" {
  description = "Listen port for the match-worker process."
  type        = number
  default     = 8788
}

variable "online_enabled" {
  description = "Whether generated browser runtime config should enable online UI."
  type        = bool
  default     = true
}
