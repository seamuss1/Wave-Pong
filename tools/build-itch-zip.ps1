[CmdletBinding()]
param(
  [string]$ZipPath,

  [switch]$SkipBuild
)

$repoRoot = Split-Path -Parent $PSScriptRoot
$buildPath = Join-Path $repoRoot 'itch-build'
function Get-RepoVersion {
  $versionFile = Join-Path $repoRoot 'version.json'
  if (-not (Test-Path $versionFile)) {
    throw "Expected version file at '$versionFile'."
  }

  $rawVersion = Get-Content $versionFile -Raw | ConvertFrom-Json
  if (-not $rawVersion.version) {
    throw "Expected 'version' in '$versionFile'."
  }

  return [string]$rawVersion.version
}

function Get-VersionedZipPath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Version
  )

  return (Join-Path $repoRoot ("wave-pong-itchio-v{0}.zip" -f $Version))
}

function Get-LatestZipPath {
  return (Join-Path $repoRoot 'wave-pong-itchio.zip')
}

$version = Get-RepoVersion
if (-not $ZipPath) {
  $ZipPath = Get-VersionedZipPath -Version $version
}

function Resolve-NodeExe {
  $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $nodeCommand) {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  }

  if (-not $nodeCommand) {
    throw "Could not find node. Install Node.js or pass -SkipBuild with an existing itch-build."
  }

  return $nodeCommand.Source
}

function Get-FileSha256 {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  return (Get-FileHash $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-ZipEntrySha256 {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ArchivePath,

    [Parameter(Mandatory = $true)]
    [string]$EntryName
  )

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [System.IO.Compression.ZipFile]::OpenRead($ArchivePath)
  try {
    $entry = $zip.GetEntry($EntryName)
    if (-not $entry) {
      throw "Expected '$EntryName' inside '$ArchivePath'."
    }

    $stream = $entry.Open()
    try {
      $sha = [System.Security.Cryptography.SHA256]::Create()
      try {
        $hashBytes = $sha.ComputeHash($stream)
      } finally {
        $sha.Dispose()
      }

      return (($hashBytes | ForEach-Object { $_.ToString('x2') }) -join '')
    } finally {
      $stream.Dispose()
    }
  } finally {
    $zip.Dispose()
  }
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

$resolvedBuildPath = (Resolve-Path $buildPath).Path
$resolvedZipPath = [System.IO.Path]::GetFullPath($ZipPath)
$resolvedLatestZipPath = [System.IO.Path]::GetFullPath((Get-LatestZipPath))

foreach ($requiredFile in @('index.html', 'wave_pong.html')) {
  $requiredPath = Join-Path $resolvedBuildPath $requiredFile
  if (-not (Test-Path $requiredPath)) {
    throw "Expected '$requiredPath' before packaging the itch.io zip."
  }
}

if (Test-Path $resolvedZipPath) {
  Remove-Item $resolvedZipPath -Force
}

Compress-Archive -Path (Join-Path $resolvedBuildPath '*') -DestinationPath $resolvedZipPath -Force

if ($resolvedLatestZipPath -ne $resolvedZipPath) {
  Copy-Item $resolvedZipPath $resolvedLatestZipPath -Force
}

$expectedHash = Get-FileSha256 -Path (Join-Path $resolvedBuildPath 'index.html')
$archivedHash = Get-ZipEntrySha256 -ArchivePath $resolvedZipPath -EntryName 'index.html'

if ($expectedHash -ne $archivedHash) {
  throw ("Packaged index.html hash mismatch. build={0} zip={1}" -f $expectedHash, $archivedHash)
}

Write-Host "Version: $version"
Write-Host "Verified itch.io zip: $resolvedZipPath"
if ($resolvedLatestZipPath -ne $resolvedZipPath) {
  Write-Host "Updated latest zip alias: $resolvedLatestZipPath"
}
Write-Host "index.html SHA256: $expectedHash"
