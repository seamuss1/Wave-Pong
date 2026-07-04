[CmdletBinding()]
param(
  [string]$SshTarget,

  [string]$SshKeyPath,

  [string]$RemoteAppDir,

  [string]$ServiceName,

  [string]$PublicUrl,

  [string]$GitBashPath,

  [switch]$SkipVerify
)

$repoRoot = Split-Path -Parent $PSScriptRoot

function Import-DotEnvFile {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  if (-not (Test-Path $Path)) {
    return
  }

  foreach ($line in Get-Content $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith('#')) {
      continue
    }

    $separatorIndex = $trimmed.IndexOf('=')
    if ($separatorIndex -lt 1) {
      continue
    }

    $name = $trimmed.Substring(0, $separatorIndex).Trim()
    $value = $trimmed.Substring($separatorIndex + 1).Trim()

    if (
      ($value.StartsWith('"') -and $value.EndsWith('"')) -or
      ($value.StartsWith("'") -and $value.EndsWith("'"))
    ) {
      $value = $value.Substring(1, $value.Length - 2)
    }

    if (-not [string]::IsNullOrWhiteSpace($name)) {
      [System.Environment]::SetEnvironmentVariable($name, $value, 'Process')
    }
  }
}

Import-DotEnvFile -Path (Join-Path $repoRoot '.env')

# Defaults describe the current production host (see AGENTS.md / hosting notes):
# VM 107 "wave-pong" on Proxmox pve01, single-port backend, systemd-managed.
if (-not $SshTarget) {
  $SshTarget = if ($env:WAVE_PONG_DEPLOY_SSH_TARGET) { $env:WAVE_PONG_DEPLOY_SSH_TARGET } else { 'codex@10.0.0.18' }
}
if (-not $SshKeyPath) {
  $SshKeyPath = if ($env:WAVE_PONG_DEPLOY_SSH_KEY) { $env:WAVE_PONG_DEPLOY_SSH_KEY } else { Join-Path $HOME '.ssh\guacamole_codex_ed25519' }
}
if (-not $RemoteAppDir) {
  $RemoteAppDir = if ($env:WAVE_PONG_DEPLOY_APP_DIR) { $env:WAVE_PONG_DEPLOY_APP_DIR } else { '/opt/wave-pong' }
}
if (-not $ServiceName) {
  $ServiceName = if ($env:WAVE_PONG_DEPLOY_SERVICE) { $env:WAVE_PONG_DEPLOY_SERVICE } else { 'wave-pong' }
}
if (-not $PublicUrl) {
  $PublicUrl = if ($env:WAVE_PONG_DEPLOY_PUBLIC_URL) { $env:WAVE_PONG_DEPLOY_PUBLIC_URL } else { 'https://wave-pong.seamusgallagher.org' }
}
if (-not $GitBashPath -and $env:GIT_BASH_PATH) {
  $GitBashPath = $env:GIT_BASH_PATH
}

function Resolve-GitBashExe {
  param(
    [string]$ExplicitPath
  )

  # The redeploy pipeline streams a binary tar archive from tar.exe straight into
  # ssh.exe's stdin. Windows PowerShell can mangle binary data piped between two
  # native executables, so that pipeline runs inside Git Bash (proven reliable),
  # not as a native PowerShell pipe.
  if ($ExplicitPath) {
    if (-not (Test-Path $ExplicitPath)) {
      throw "Git Bash not found at '$ExplicitPath'."
    }

    return (Resolve-Path $ExplicitPath).Path
  }

  $commonPaths = @(
    'C:\Program Files\Git\bin\bash.exe',
    'C:\Program Files\Git\usr\bin\bash.exe',
    'C:\Program Files (x86)\Git\bin\bash.exe'
  )

  foreach ($candidate in $commonPaths) {
    if (Test-Path $candidate) {
      return (Resolve-Path $candidate).Path
    }
  }

  $gitBashCommand = Get-Command bash.exe -ErrorAction SilentlyContinue |
    Where-Object { $_.Source -like '*Git*' } |
    Select-Object -First 1

  if ($gitBashCommand) {
    return $gitBashCommand.Source
  }

  throw "Could not find Git Bash (needed to run the tar | ssh redeploy pipeline). Install Git for Windows or pass -GitBashPath."
}

function Resolve-NodeExe {
  $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $nodeCommand) {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  }

  if (-not $nodeCommand) {
    throw "Could not find node. Install Node.js, or pass -SkipVerify to skip the post-deploy check."
  }

  return $nodeCommand.Source
}

function ConvertTo-PosixPath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$WindowsPath
  )

  $full = (Resolve-Path $WindowsPath).Path
  $drive = $full.Substring(0, 1).ToLowerInvariant()
  $rest = $full.Substring(2) -replace '\\', '/'
  return "/$drive$rest"
}

$gitBashExe = Resolve-GitBashExe -ExplicitPath $GitBashPath
$posixRepoRoot = ConvertTo-PosixPath -WindowsPath $repoRoot
$posixSshKeyPath = ConvertTo-PosixPath -WindowsPath $SshKeyPath

foreach ($requiredDir in @('backend', 'shared', 'runtime')) {
  if (-not (Test-Path (Join-Path $repoRoot $requiredDir))) {
    throw "Expected '$requiredDir' under '$repoRoot' before redeploying the server."
  }
}

Write-Host "Redeploying backend/shared/runtime to ${SshTarget}:${RemoteAppDir} ..."

$remoteCommand = "tar xzf - -C '$RemoteAppDir' && sudo systemctl restart $ServiceName"
$bashCommand = "cd '$posixRepoRoot' && tar czf - backend shared runtime version.json | ssh -i '$posixSshKeyPath' -o StrictHostKeyChecking=accept-new '$SshTarget' '$remoteCommand'"

& $gitBashExe -lc $bashCommand
if ($LASTEXITCODE -ne 0) {
  throw "Server redeploy failed (tar | ssh pipeline exited $LASTEXITCODE)."
}

$statusCommand = "ssh -i '$posixSshKeyPath' -o StrictHostKeyChecking=accept-new '$SshTarget' 'sudo systemctl is-active $ServiceName'"
& $gitBashExe -lc $statusCommand
if ($LASTEXITCODE -ne 0) {
  throw "Remote service '$ServiceName' is not active after redeploy."
}

if ($SkipVerify) {
  Write-Host "Skipping post-deploy verification (-SkipVerify)."
  exit 0
}

$nodeExe = Resolve-NodeExe
$onlineE2ePath = Join-Path $repoRoot 'backend\tests\online-e2e.js'
Write-Host "Verifying deployed backend against $PublicUrl ..."
& $nodeExe $onlineE2ePath $PublicUrl
if ($LASTEXITCODE -ne 0) {
  throw "Post-deploy verification (online-e2e) failed against $PublicUrl."
}

Write-Host "Server redeploy verified OK: $PublicUrl"
