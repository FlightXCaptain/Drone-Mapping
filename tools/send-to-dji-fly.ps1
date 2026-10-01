<#
.SYNOPSIS
  Put a Drone Mapping KMZ onto a DJI RC 2 / DJI RC (or Android phone) as a DJI Fly waypoint mission.

.DESCRIPTION
  DJI Fly has no import button. The workaround is to replace the .kmz of a placeholder mission
  in Android/data/dji.go.v5/files/waypoint/<UUID>/. This script does that over USB (MTP):

    1. Finds the controller (it must be switched ON and connected by a data USB cable).
    2. Lists the DJI Fly missions on it with their waypoint counts so you can pick the placeholder.
    3. Backs the placeholder up to Documents\Drone Mapping\backups.
    4. Copies your KMZ in under the placeholder's UUID name.
    5. Reads it back and checks it matches.

  Close DJI Fly on the controller first. If it's running it can keep showing (or re-save) the old mission.
  The thumbnail in DJI Fly's mission list will still show the old route. That's expected; open the mission
  to see the new one.

.PARAMETER Kmz
  The mission file to send. Defaults to the newest .kmz in your Downloads folder.

.PARAMETER Mission
  The placeholder's UUID. If omitted you are asked to choose.

.PARAMETER WhatIf
  Show what would happen (and make the backup) without changing anything on the controller.

.EXAMPLE
  .\send-to-dji-fly.ps1
  .\send-to-dji-fly.ps1 -Kmz "$HOME\Downloads\Smith_farm.kmz" -WhatIf
#>
[CmdletBinding()]
param(
  [string]$Kmz,
  [string]$Mission,
  [switch]$WhatIf
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Fail($msg) { Write-Host "`n$msg" -ForegroundColor Red; exit 1 }

# ---- The mission file ----------------------------------------------------------------------
if (-not $Kmz) {
  $dl = Join-Path $HOME 'Downloads'
  $latest = Get-ChildItem $dl -Filter *.kmz -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $latest) { Fail "No .kmz found in $dl. Download one from Send to drone first, or pass -Kmz <file>." }
  $Kmz = $latest.FullName
}
if (-not (Test-Path $Kmz)) { Fail "Can't find $Kmz" }
$Kmz = (Resolve-Path $Kmz).Path

function Get-WaypointCount([string]$path) {
  try {
    $zip = [IO.Compression.ZipFile]::OpenRead($path)
    try {
      $entry = $zip.Entries | Where-Object FullName -eq 'wpmz/waylines.wpml' | Select-Object -First 1
      if (-not $entry) { return $null }
      $text = (New-Object IO.StreamReader($entry.Open())).ReadToEnd()
      return ([regex]::Matches($text, '<Placemark>')).Count
    } finally { $zip.Dispose() }
  } catch { return $null }
}

$newCount = Get-WaypointCount $Kmz
if (-not $newCount) { Fail "$Kmz doesn't look like a DJI waypoint mission (no wpmz/waylines.wpml)." }
Write-Host "Mission file: $Kmz ($newCount waypoints)"

# ---- Find the controller over MTP ------------------------------------------------------------
$shell = New-Object -ComObject Shell.Application
$device = $shell.Namespace(17).Items() | Where-Object { $_.Name -match 'DJI|RC' -and -not $_.IsFileSystem } | Select-Object -First 1
if (-not $device) {
  Fail "No DJI controller found. Switch the controller ON, connect it with a data USB cable, and wait for it to appear in File Explorer."
}
Write-Host "Controller:   $($device.Name)"

$folder = ($device.GetFolder.Items() | Select-Object -First 1).GetFolder
foreach ($seg in 'Android', 'data', 'dji.go.v5', 'files', 'waypoint') {
  $next = $folder.Items() | Where-Object { $_.Name -eq $seg } | Select-Object -First 1
  if (-not $next) { Fail "Couldn't find DJI Fly's waypoint folder ($seg missing). Create and save one waypoint mission in DJI Fly first." }
  $folder = $next.GetFolder
}
$waypointDir = $folder

$missions = @($waypointDir.Items() | Where-Object { $_.IsFolder -and $_.Name -match '^[0-9A-Fa-f-]{36}$' })
if ($missions.Count -eq 0) { Fail "No DJI Fly missions on the controller. In DJI Fly, create and save a short waypoint mission to use as a placeholder." }

# ---- Show what's there so the right placeholder gets replaced --------------------------------
$tmp = Join-Path $env:TEMP "drone-mapping-$([guid]::NewGuid())"
New-Item -ItemType Directory $tmp | Out-Null
function Copy-FromDevice($item, [string]$toDir) {
  $shell.Namespace($toDir).CopyHere($item, 0x14)
  $target = Join-Path $toDir $item.Name
  for ($i = 0; $i -lt 100 -and -not (Test-Path $target); $i++) { Start-Sleep -Milliseconds 200 }
  Start-Sleep -Milliseconds 300
  return $target
}

Write-Host "`nDJI Fly missions on the controller:"
$rows = @()
for ($i = 0; $i -lt $missions.Count; $i++) {
  $m = $missions[$i]
  $kmzItem = $m.GetFolder.Items() | Where-Object { $_.Name -eq "$($m.Name).kmz" } | Select-Object -First 1
  $count = '?'
  if ($kmzItem) {
    $d = Join-Path $tmp "peek$i"; New-Item -ItemType Directory $d | Out-Null
    $count = Get-WaypointCount (Copy-FromDevice $kmzItem $d)
  }
  $rows += [pscustomobject]@{ No = $i + 1; Mission = $m.Name; Waypoints = $count }
}
$rows | Format-Table -AutoSize | Out-Host

if ($Mission) {
  $target = $missions | Where-Object { $_.Name -eq $Mission } | Select-Object -First 1
  if (-not $target) { Fail "Mission $Mission isn't on the controller." }
} elseif ($missions.Count -eq 1) {
  $target = $missions[0]
  Write-Host "Only one mission, so that's the placeholder: $($target.Name)"
} else {
  $pick = Read-Host "Which mission is the placeholder to replace? (1-$($missions.Count))"
  if (-not ($pick -as [int]) -or [int]$pick -lt 1 -or [int]$pick -gt $missions.Count) { Fail 'Cancelled.' }
  $target = $missions[[int]$pick - 1]
}
$uuid = $target.Name
$targetDir = $target.GetFolder
$oldItem = $targetDir.Items() | Where-Object { $_.Name -eq "$uuid.kmz" } | Select-Object -First 1

# ---- Back up the placeholder -----------------------------------------------------------------
$backupDir = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Drone Mapping\backups'
New-Item -ItemType Directory -Force $backupDir | Out-Null
if ($oldItem) {
  $b = Join-Path $tmp 'backup'; New-Item -ItemType Directory $b | Out-Null
  $copied = Copy-FromDevice $oldItem $b
  $backup = Join-Path $backupDir "$uuid-$(Get-Date -Format yyyyMMdd-HHmmss).kmz"
  Move-Item $copied $backup
  Write-Host "Backed up the placeholder to $backup"
}

if ($WhatIf) {
  Write-Host "`n-WhatIf: would replace $uuid.kmz with $(Split-Path $Kmz -Leaf). Nothing on the controller was changed." -ForegroundColor Yellow
  Remove-Item -Recurse -Force $tmp
  exit 0
}

# ---- Replace it ------------------------------------------------------------------------------
$stage = Join-Path $tmp 'stage'; New-Item -ItemType Directory $stage | Out-Null
$staged = Join-Path $stage "$uuid.kmz"
Copy-Item $Kmz $staged
# MTP can't overwrite in place reliably, so remove the old file first.
if ($oldItem) {
  $oldItem.InvokeVerbEx('delete')
  for ($i = 0; $i -lt 50 -and ($targetDir.Items() | Where-Object { $_.Name -eq "$uuid.kmz" }); $i++) { Start-Sleep -Milliseconds 200 }
}
$targetDir.CopyHere($staged, 0x14)
for ($i = 0; $i -lt 100 -and -not ($targetDir.Items() | Where-Object { $_.Name -eq "$uuid.kmz" }); $i++) { Start-Sleep -Milliseconds 200 }
Start-Sleep -Seconds 1

# ---- Verify ----------------------------------------------------------------------------------
$placed = $targetDir.Items() | Where-Object { $_.Name -eq "$uuid.kmz" } | Select-Object -First 1
if (-not $placed) { Fail "The copy didn't arrive. Your placeholder backup is in $backupDir." }
$v = Join-Path $tmp 'verify'; New-Item -ItemType Directory $v | Out-Null
$back = Copy-FromDevice $placed $v
if ((Get-FileHash $back).Hash -ne (Get-FileHash $Kmz).Hash) {
  Fail "The file on the controller doesn't match what was sent. Try again; your placeholder backup is in $backupDir."
}
Remove-Item -Recurse -Force $tmp

Write-Host "`nDone. Mission $uuid now holds $newCount waypoints." -ForegroundColor Green
Write-Host "Unplug, open DJI Fly, and open that mission (its thumbnail still shows the old route until you do)."
Write-Host "Check the route, heights and lost-signal action before take-off."
