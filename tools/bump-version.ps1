[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('patch', 'minor', 'major')]
  [string]$Level
)

$repoRoot = Split-Path -Parent $PSScriptRoot
$versionPath = Join-Path $repoRoot 'version.json'

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
Write-Host "Updated version: $newVersion"
