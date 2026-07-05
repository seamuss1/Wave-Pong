[CmdletBinding()]
param(
  [ValidateSet('test', 'production')]
  [string]$Destination = 'test',

  [string]$Target,

  [string]$BuildPath,

  [string]$UserVersion,

  [string]$ButlerPath,

  [switch]$SkipBuild,

  # By default every itch.io deploy first redeploys the backend server (VM 107)
  # and verifies it live, so the itch build's online play always talks to
  # current server code. Pass this to build/push an itch artifact only.
  [switch]$SkipServerDeploy,

  # Skip the post-redeploy online-e2e verification (passed through to deploy-server.ps1).
  [switch]$SkipServerVerify,

  # Build the itch artifact with online play disabled instead of pointing it at
  # the public server URL.
  [switch]$DisableOnline,

  [string]$PublicUrl
)

$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $BuildPath) {
  $BuildPath = Join-Path $repoRoot 'itch-build'
}

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

if (-not $ButlerPath -and $env:BUTLER_PATH) {
  $ButlerPath = $env:BUTLER_PATH
}

if (-not $PublicUrl) {
  $PublicUrl = if ($env:WAVE_PONG_DEPLOY_PUBLIC_URL) { $env:WAVE_PONG_DEPLOY_PUBLIC_URL } else { 'https://wave-pong.seamusgallagher.org' }
}

if (-not $SkipServerDeploy) {
  Write-Host "Redeploying backend server before pushing to itch.io (pass -SkipServerDeploy to push without redeploying the server)..."
  # Splatting named parameters requires a hashtable; an array splats positionally.
  $deployServerArgs = @{ PublicUrl = $PublicUrl }
  if ($SkipServerVerify) {
    $deployServerArgs.SkipVerify = $true
  }
  & (Join-Path $PSScriptRoot 'deploy-server.ps1') @deployServerArgs
} else {
  Write-Host "Skipping backend server redeploy (-SkipServerDeploy)."
}

if (-not $Target) {
  switch ($Destination) {
    'test' {
      $Target = if ($env:ITCH_TARGET_TEST) { $env:ITCH_TARGET_TEST } else { 'rainman1337/wave-pong-test:html5' }
    }
    'production' {
      $Target = if ($env:ITCH_TARGET_PRODUCTION) { $env:ITCH_TARGET_PRODUCTION } else { 'rainman1337/wave-pong:html5' }
    }
    default {
      throw "Unsupported destination '$Destination'."
    }
  }
}

function Resolve-ButlerExe {
  param(
    [string]$ExplicitPath
  )

  if ($ExplicitPath) {
    if (-not (Test-Path $ExplicitPath)) {
      throw "Butler executable not found at '$ExplicitPath'."
    }

    return (Resolve-Path $ExplicitPath).Path
  }

  $commonStandalonePaths = @(
    'C:\Program Files\butler-windows-amd64\butler.exe',
    'C:\Program Files (x86)\butler-windows-amd64\butler.exe'
  )

  foreach ($candidate in $commonStandalonePaths) {
    if (Test-Path $candidate) {
      return (Resolve-Path $candidate).Path
    }
  }

  $butlerCommand = Get-Command butler.exe -ErrorAction SilentlyContinue
  if ($butlerCommand) {
    return $butlerCommand.Source
  }

  $itchButlerRoot = Join-Path $env:APPDATA 'itch\broth\butler'
  $chosenVersionFile = Join-Path $itchButlerRoot '.chosen-version'
  if (Test-Path $chosenVersionFile) {
    $chosenVersion = (Get-Content $chosenVersionFile -ErrorAction Stop | Select-Object -First 1).Trim()
    if ($chosenVersion) {
      $chosenButlerPath = Join-Path $itchButlerRoot ("versions\" + $chosenVersion + "\butler.exe")
      if (Test-Path $chosenButlerPath) {
        return $chosenButlerPath
      }
    }
  }

  $itchVersionRoot = Join-Path $itchButlerRoot 'versions'
  if (Test-Path $itchVersionRoot) {
    $butlerExe = Get-ChildItem -Path $itchVersionRoot -Filter butler.exe -Recurse -File |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1

    if ($butlerExe) {
      return $butlerExe.FullName
    }
  }

  throw "Could not find butler.exe. Install butler, install the itch app, add butler to PATH, or pass -ButlerPath."
}

function Resolve-NodeExe {
  $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $nodeCommand) {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  }

  if (-not $nodeCommand) {
    throw "Could not find node. Install Node.js or pass -SkipBuild and use an already generated itch-build."
  }

  return $nodeCommand.Source
}

function Get-RepoVersion {
  $versionFile = Join-Path $repoRoot 'version.json'
  if (-not (Test-Path $versionFile)) {
    throw "Expected version file at '$versionFile'."
  }

  $versionData = Get-Content $versionFile -Raw | ConvertFrom-Json
  if (-not $versionData.version) {
    throw "Expected 'version' in '$versionFile'."
  }

  return [string]$versionData.version
}

if (-not $SkipBuild) {
  # itch.io is served over https, so the build only wires up online play when it
  # can point at an https/wss endpoint. Default that to the just-redeployed public
  # server unless the caller already set ITCH_RUNTIME_ENV_JSON or asked to disable it.
  if ($DisableOnline) {
    Write-Host "Building itch.io artifact with online play disabled (-DisableOnline)."
    Remove-Item Env:\ITCH_RUNTIME_ENV_JSON -ErrorAction SilentlyContinue
  } elseif ($env:ITCH_RUNTIME_ENV_JSON) {
    Write-Host "Building itch.io artifact with ITCH_RUNTIME_ENV_JSON override from environment/.env."
  } else {
    $wsBaseUrl = $PublicUrl -replace '^http', 'ws'
    $defaultRuntimeEnv = [ordered]@{
      apiBaseUrl   = $PublicUrl
      controlWsUrl = "$wsBaseUrl/ws/control"
      workerWsUrl  = "$wsBaseUrl/ws/match"
      enabled      = $true
    }
    $env:ITCH_RUNTIME_ENV_JSON = $defaultRuntimeEnv | ConvertTo-Json -Compress
    Write-Host "Building itch.io artifact with online play pointed at $PublicUrl"
  }

  $nodeExe = Resolve-NodeExe
  $builderPath = Join-Path $PSScriptRoot 'build-itch-html.js'
  Write-Host "Building itch.io artifact with: $nodeExe $builderPath"
  & $nodeExe $builderPath
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}

$resolvedBuildPath = (Resolve-Path $BuildPath).Path
if (-not (Test-Path (Join-Path $resolvedBuildPath 'index.html'))) {
  throw "Expected '$resolvedBuildPath' to contain index.html for an itch.io HTML5 upload."
}

$resolvedButler = Resolve-ButlerExe -ExplicitPath $ButlerPath

if (-not $UserVersion) {
  $UserVersion = Get-RepoVersion
}

$arguments = @('push', $resolvedBuildPath, $Target)
if ($UserVersion) {
  $arguments += @('--userversion', $UserVersion)
}

Write-Host "Using butler: $resolvedButler"
Write-Host "Build path: $resolvedBuildPath"
Write-Host "Target: $Target"
if ($UserVersion) {
  Write-Host "User version: $UserVersion"
}

if (-not $env:BUTLER_API_KEY) {
  Write-Host "BUTLER_API_KEY is not set in the shell or .env. That is fine if this machine is already authenticated with 'butler login'."
}

# Invoke butler via Start-Process -Wait rather than the call operator (&).
# The call operator waits for butler's stdout/stderr streams to reach EOF, but
# `butler push` leaves a short-lived detached helper (self-update check / upload
# daemon) holding those inherited handles for up to several minutes after the
# upload itself has finished. That made this script appear to hang long after the
# build was already processing on itch.io. Start-Process -Wait waits on the
# process handle instead, so it returns as soon as butler.exe exits; -NoNewWindow
# keeps butler's live progress output in this console.
# Pre-quote any argument containing whitespace: Windows PowerShell's -ArgumentList
# joins array elements with spaces and does not quote elements itself, so an
# unquoted build path with a space would split into multiple arguments.
$butlerArguments = $arguments | ForEach-Object {
  if ($_ -match '\s') { '"' + $_ + '"' } else { $_ }
}
$butlerProcess = Start-Process -FilePath $resolvedButler -ArgumentList $butlerArguments -NoNewWindow -Wait -PassThru
if ($butlerProcess.ExitCode -ne 0) {
  exit $butlerProcess.ExitCode
}
