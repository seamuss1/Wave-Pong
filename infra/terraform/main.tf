locals {
  generated_dir  = "${path.module}/generated/${var.environment}"
  control_ws_url = replace(var.control_plane_public_url, "https://", "wss://")
  backend_env = {
    NODE_ENV                         = var.environment == "prod" ? "production" : "development"
    WAVE_PONG_ENVIRONMENT            = var.environment
    WAVE_PONG_SECRET                 = var.wave_pong_secret
    WAVE_PONG_CONTROL_PORT           = var.control_port
    WAVE_PONG_WORKER_PORT            = var.worker_port
    WAVE_PONG_PUBLIC_API_BASE_URL    = trimsuffix(var.control_plane_public_url, "/")
    WAVE_PONG_PUBLIC_CONTROL_WS_URL  = "${trimsuffix(local.control_ws_url, "/")}/ws/control"
    WAVE_PONG_PUBLIC_WORKER_WS_URL   = trimsuffix(var.match_worker_public_ws_url, "/")
    WAVE_PONG_INTERNAL_WORKER_WS_URL = trimsuffix(var.match_worker_internal_ws_url, "/")
    WAVE_PONG_STATIC_CLIENT_ORIGIN   = trimsuffix(var.static_client_origin, "/")
    WAVE_PONG_ONLINE_ENABLED         = var.online_enabled ? "true" : "false"
    DATABASE_URL                     = var.database_url
    REDIS_URL                        = var.redis_url
  }
  backend_env_text = "${join("\n", [for key, value in local.backend_env : "${key}=${value}"])}\n"
  runtime_env = {
    apiBaseUrl   = local.backend_env.WAVE_PONG_PUBLIC_API_BASE_URL
    controlWsUrl = local.backend_env.WAVE_PONG_PUBLIC_CONTROL_WS_URL
    workerWsUrl  = local.backend_env.WAVE_PONG_PUBLIC_WORKER_WS_URL
    enabled      = var.online_enabled
  }
}

resource "local_file" "backend_env" {
  filename = "${local.generated_dir}/wave-pong-backend.env"
  content  = local.backend_env_text
}

resource "local_file" "runtime_env" {
  filename = "${local.generated_dir}/runtime-env.js"
  content  = <<-EOT
    (function (root) {
      if (!root) return;
      const injected = root.__WAVE_PONG_ENV__ || {};
      root.__WAVE_PONG_ENV__ = Object.assign(${jsonencode(local.runtime_env)}, injected);
    })(typeof globalThis !== 'undefined' ? globalThis : this);
  EOT
}

resource "local_file" "deploy_contract" {
  filename = "${local.generated_dir}/deploy-contract.json"
  content = jsonencode({
    environment   = var.environment
    appName       = var.app_name
    staticClient  = var.static_client_origin
    controlPlane  = trimsuffix(var.control_plane_public_url, "/")
    controlWs     = local.backend_env.WAVE_PONG_PUBLIC_CONTROL_WS_URL
    matchWorkerWs = trimsuffix(var.match_worker_public_ws_url, "/")
    generated = {
      backendEnv = local_file.backend_env.filename
      runtimeEnv = local_file.runtime_env.filename
    }
  })
}
