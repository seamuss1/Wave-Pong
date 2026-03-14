[CmdletBinding()]
param(
  [string]$Target = 'runtime/index.html',

  [int]$TimeoutMs = 8000,

  [string]$BrowserPath
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot

function Resolve-NodeExe {
  $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $nodeCommand) {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  }

  if (-not $nodeCommand) {
    throw 'Could not find node. Install Node.js to run the smoke test.'
  }

  return $nodeCommand.Source
}

function Resolve-BrowserPath {
  param(
    [string]$ExplicitPath
  )

  $localAppData = ''
  if ($env:LOCALAPPDATA) {
    $localAppData = $env:LOCALAPPDATA
  }

  $candidates = @(
    $ExplicitPath,
    $env:BROWSER_BIN,
    $env:EDGE_BIN,
    $env:CHROME_BIN,
    'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
    'C:\Program Files\Google\Chrome\Application\chrome.exe',
    'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
    (Join-Path $localAppData 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $localAppData 'Google\Chrome\Application\chrome.exe')
  ) | Where-Object { $_ }

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return (Resolve-Path $candidate).Path
    }
  }

  throw 'No supported Chromium browser was found. Pass -BrowserPath or set BROWSER_BIN.'
}

function Resolve-SmokeTarget {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Value
  )

  if ($Value -match '^(https?|file):') {
    return $Value
  }

  $candidates = @()
  try {
    $candidates += (Resolve-Path $Value -ErrorAction Stop).Path
  } catch {
  }

  try {
    $candidates += (Resolve-Path (Join-Path $repoRoot $Value) -ErrorAction Stop).Path
  } catch {
  }

  $resolved = $candidates | Select-Object -Unique | Select-Object -First 1
  if ($resolved) {
    return $resolved
  }

  return $Value
}

function Get-FreeTcpPort {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  try {
    $listener.Start()
    return $listener.LocalEndpoint.Port
  } finally {
    $listener.Stop()
  }
}

function Wait-ForDevTools {
  param(
    [int]$Port,
    [int]$TimeoutMs
  )

  $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
  while ([DateTime]::UtcNow -lt $deadline) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Port/json/version" -TimeoutSec 2
      if ($response.Content) {
        return
      }
    } catch {
      Start-Sleep -Milliseconds 200
    }
  }

  throw "DevTools endpoint did not become available on port $Port before timeout."
}

function Stop-BrowserProcessByPort {
  param(
    [Parameter(Mandatory = $true)]
    [int]$Port
  )

  $netstatOutput = netstat -ano -p tcp 2>$null
  if (-not $netstatOutput) {
    return
  }

  $pattern = "^\s*TCP\s+\S+:$Port\s+\S+\s+LISTENING\s+(\d+)\s*$"
  $processId = $null

  foreach ($line in $netstatOutput) {
    if ($line -match $pattern) {
      $processId = [int]$Matches[1]
      break
    }
  }

  if (-not $processId) {
    return
  }

  taskkill /PID $processId /T /F | Out-Null
}

function Remove-PathWithRetries {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,

    [int]$Attempts = 12,

    [int]$DelayMs = 250
  )

  for ($attempt = 0; $attempt -lt $Attempts; $attempt += 1) {
    if (-not (Test-Path $Path)) {
      return
    }

    try {
      Remove-Item $Path -Recurse -Force
      return
    } catch {
      if ($attempt -eq ($Attempts - 1)) {
        throw
      }
      Start-Sleep -Milliseconds $DelayMs
    }
  }
}

$nodeExe = Resolve-NodeExe
$resolvedBrowser = Resolve-BrowserPath -ExplicitPath $BrowserPath
$resolvedTarget = Resolve-SmokeTarget -Value $Target
$port = Get-FreeTcpPort
$startupTimeoutMs = [Math]::Max($TimeoutMs, 15000)
$profileDir = Join-Path ([System.IO.Path]::GetTempPath()) ("wave-pong-smoke-" + [System.Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $profileDir | Out-Null

$browserProcess = $null
$browserArgs = @(
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--allow-file-access-from-files',
  '--remote-allow-origins=*',
  '--remote-debugging-address=127.0.0.1',
  "--remote-debugging-port=$port",
  "--user-data-dir=$profileDir",
  'about:blank'
)

try {
  $browserProcess = Start-Process -FilePath $resolvedBrowser -ArgumentList $browserArgs -PassThru -WindowStyle Hidden
  Wait-ForDevTools -Port $port -TimeoutMs $startupTimeoutMs

  $nodeArgs = @(
    (Join-Path $PSScriptRoot 'browser-smoke-test.js'),
    '--target', $resolvedTarget,
    '--timeout-ms', $TimeoutMs,
    '--attach-port', $port,
    '--browser', $resolvedBrowser
  )

  & $nodeExe @nodeArgs
  exit $LASTEXITCODE
} finally {
  Stop-BrowserProcessByPort -Port $port
  if ($browserProcess -and (Get-Process -Id $browserProcess.Id -ErrorAction SilentlyContinue)) {
    Stop-Process -Id $browserProcess.Id -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Milliseconds 500

  Remove-PathWithRetries -Path $profileDir
}
