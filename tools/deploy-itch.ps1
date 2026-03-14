[CmdletBinding()]
param(
  [ValidateSet('test', 'production')]
  [string]$Destination = 'test',

  [string]$Target,

  [string]$BuildPath,

  [string]$UserVersion,

  [string]$ButlerPath,

  [switch]$SkipBuild
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

if (-not $SkipBuild) {
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

& $resolvedButler @arguments
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
