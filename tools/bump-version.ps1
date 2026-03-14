[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('patch', 'minor', 'major')]
  [string]$Level
)

$repoRoot = Split-Path -Parent $PSScriptRoot
$versionPath = Join-Path $repoRoot 'version.json'
$runtimeVersionPath = Join-Path $repoRoot 'runtime\js\version.js'
$runtimeIndexPath = Join-Path $repoRoot 'runtime\index.html'

if (-not (Test-Path $versionPath)) {
  throw "Expected version file at '$versionPath'."
}

$versionData = Get-Content $versionPath -Raw | ConvertFrom-Json
if (-not $versionData.version) {
  throw "Expected 'version' in '$versionPath'."
}

$parts = $versionData.version -split '\.'
if ($parts.Count -ne 3) {
  throw "Expected semantic version format 'major.minor.patch' in '$versionPath'."
}

$major = [int]$parts[0]
$minor = [int]$parts[1]
$patch = [int]$parts[2]

switch ($Level) {
  'patch' {
    $patch += 1
  }
  'minor' {
    $minor += 1
    $patch = 0
  }
  'major' {
    $major += 1
    $minor = 0
    $patch = 0
  }
}

$newVersion = '{0}.{1}.{2}' -f $major, $minor, $patch
$updatedJson = [ordered]@{
  version = $newVersion
} | ConvertTo-Json

[System.IO.File]::WriteAllText($versionPath, $updatedJson + [Environment]::NewLine)
[System.IO.File]::WriteAllText(
  $runtimeVersionPath,
  "(function (root, version) {" + [Environment]::NewLine +
  "  if (typeof module === 'object' && module.exports) {" + [Environment]::NewLine +
  "    module.exports = version;" + [Environment]::NewLine +
  "  }" + [Environment]::NewLine +
  "  if (root) {" + [Environment]::NewLine +
  "    root.WavePong = root.WavePong || {};" + [Environment]::NewLine +
  "    root.WavePong.VERSION = version;" + [Environment]::NewLine +
  "  }" + [Environment]::NewLine +
  "})(typeof globalThis !== 'undefined' ? globalThis : this, '" + $newVersion + "');" + [Environment]::NewLine
)

if (-not (Test-Path $runtimeIndexPath)) {
  throw "Expected runtime index file at '$runtimeIndexPath'."
}

$runtimeIndex = Get-Content $runtimeIndexPath -Raw
$updatedRuntimeIndex = [System.Text.RegularExpressions.Regex]::Replace(
  $runtimeIndex,
  '(<div id="menuVersion" class="menuVersion">)v[^<]+(</div>)',
  ('$1v' + $newVersion + '$2'),
  [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
)

if ($updatedRuntimeIndex -eq $runtimeIndex) {
  throw "Could not update the menu version placeholder in '$runtimeIndexPath'."
}

[System.IO.File]::WriteAllText($runtimeIndexPath, $updatedRuntimeIndex)
Write-Host "Updated version: $newVersion"
