
param(
  [string]$RepoRoot = ""
)

$ErrorActionPreference = "Stop"

function Get-FreeDriveLetter {
  $used = (Get-PSDrive -PSProvider FileSystem).Name
  foreach ($c in @('Z','Y','X','W','V','U','T')) {
    if ($used -notcontains $c) { return $c }
  }
  return $null
}

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\")).ProviderPath
}

if ($RepoRoot.StartsWith('\\')) {
  Write-Host "UNC path detected. Mapping a temporary drive for npm/vite..." -ForegroundColor Yellow
  $letter = Get-FreeDriveLetter
  if (-not $letter) {
    throw "No free drive letter available to map the UNC path."
  }
  New-PSDrive -Name $letter -PSProvider FileSystem -Root $RepoRoot -Persist -Scope Global | Out-Null
  $RepoRoot = "$letter`:\\"
}

$webPath = Join-Path $RepoRoot "web"

Write-Host "Web path: $webPath" -ForegroundColor Cyan

if (-not (Test-Path (Join-Path $webPath 'package.json'))) {
  throw "Sanity check failed: $webPath\\package.json not found (drive mapping may have failed)."
}

npm --prefix $webPath install | Out-Host
npm --prefix $webPath run build | Out-Host
npm --prefix $webPath run deploy | Out-Host
