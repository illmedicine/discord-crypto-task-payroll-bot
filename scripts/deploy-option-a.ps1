param(
  [string]$ServiceName = "dcb-payroll-backend",
  [string]$UiBase = "https://illmedicine.github.io/discord-crypto-task-payroll-bot/"
)

$ErrorActionPreference = "Stop"

function Get-FreeDriveLetter {
  $used = (Get-PSDrive -PSProvider FileSystem).Name
  foreach ($c in @('Z','Y','X','W','V','U','T')) {
    if ($used -notcontains $c) { return $c }
  }
  return $null
}

function Assert-Command($name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "Missing required command: $name"
  }
}

function Read-SecretPlain([string]$Prompt) {
  $sec = Read-Host -Prompt $Prompt -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

function Set-RailwayVarFromStdin([string]$Key, [string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) {
    throw "Refusing to set empty value for $Key"
  }
  $Value | railway variable set -s $ServiceName $Key --stdin | Out-Host
}

Write-Host "[1/6] Preflight" -ForegroundColor Cyan
Assert-Command "node"
Assert-Command "npm"
Assert-Command "git"
Assert-Command "railway"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).ProviderPath

if ($repoRoot.StartsWith('\\')) {
  Write-Host "UNC path detected. Mapping a temporary drive for npm compatibility..." -ForegroundColor Yellow
  $letter = Get-FreeDriveLetter
  if (-not $letter) {
    throw "No free drive letter available to map the UNC path. Please unmount a drive and retry."
  }

  $driveName = $letter
  New-PSDrive -Name $driveName -PSProvider FileSystem -Root $repoRoot -Scope Process | Out-Null
  $repoRoot = "$driveName`:\\"
}

Write-Host "Repo root: $repoRoot"

Write-Host "[2/6] Install backend deps" -ForegroundColor Cyan
npm --prefix "$repoRoot\apps\backend" install | Out-Host

Write-Host "[3/6] Install web deps + build" -ForegroundColor Cyan
npm --prefix "$repoRoot\web" install | Out-Host
npm --prefix "$repoRoot\web" run build | Out-Host

Write-Host "[4/6] Railway login/link" -ForegroundColor Cyan
try {
  railway whoami | Out-Host
} catch {
  Write-Host "You are not logged into Railway. A browser login may open." -ForegroundColor Yellow
  railway login | Out-Host
}

Write-Host "Link this directory to your EXISTING Railway project when prompted." -ForegroundColor Yellow
railway link | Out-Host

Write-Host "[5/6] Create/link service + set vars" -ForegroundColor Cyan
try {
  railway add --service $ServiceName | Out-Host
} catch {
  Write-Host "railway add may have failed (service might already exist). Continuing..." -ForegroundColor Yellow
}

railway service link $ServiceName | Out-Host

railway variable set -s $ServiceName "NODE_ENV=production" "DCB_UI_BASE=$UiBase" "DCB_COOKIE_SAMESITE=none" --skip-deploys | Out-Host

Write-Host "Now enter secrets (input is hidden)." -ForegroundColor Yellow
$sessionSecret = Read-SecretPlain "DCB_SESSION_SECRET"
$discordToken = Read-SecretPlain "DISCORD_TOKEN"
$discordClientId = Read-Host "DISCORD_CLIENT_ID"
$discordClientSecret = Read-SecretPlain "DISCORD_CLIENT_SECRET"

Set-RailwayVarFromStdin "DCB_SESSION_SECRET" $sessionSecret
Set-RailwayVarFromStdin "DISCORD_TOKEN" $discordToken
railway variable set -s $ServiceName "DISCORD_CLIENT_ID=$discordClientId" | Out-Host
Set-RailwayVarFromStdin "DISCORD_CLIENT_SECRET" $discordClientSecret

Write-Host "[6/6] Deploy backend from apps/backend" -ForegroundColor Cyan
railway up --service $ServiceName --detach "$repoRoot\apps\backend" | Out-Host

Write-Host "\nNext:" -ForegroundColor Green
Write-Host "1) In Railway, open the service and copy its PUBLIC URL (NOT *.railway.internal)." -ForegroundColor Green
Write-Host "2) Set DCB_PUBLIC_URL to that public URL (e.g. https://xxxx.up.railway.app)" -ForegroundColor Green
Write-Host "3) Open: <backend-url>/api/health and <backend-url>/auth/discord" -ForegroundColor Green
Write-Host "4) Once backend URL is known, we will repoint the GitHub Pages frontend to it." -ForegroundColor Green
