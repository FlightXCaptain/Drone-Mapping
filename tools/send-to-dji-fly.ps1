<#
.SYNOPSIS
  Put a Drone Mapping KMZ onto a DJI RC 2 / DJI RC (or Android phone) as a DJI Fly waypoint mission.

.DESCRIPTION
  DJI Fly has no import button. The workaround is to replace the .kmz of a placeholder mission
  in Android/data/dji.go.v5/files/waypoint/<UUID>/. This script does that over USB (MTP).

  Safety rules (each enforced in code, not just by convention):
    * Over MTP only the controller's shared storage is reachable - never system files or firmware.
    * The ONLY file ever written is  Android/data/dji.go.v5/files/waypoint/<UUID>/<UUID>.kmz
      Every folder on the way is matched by exact name; nothing else (image, map_preview,
      capability, other missions) is ever written or deleted.
    * The device must be an MTP device that has DJI Fly's waypoint folder on it.
    * The new KMZ is validated first: a zip with exactly wpmz/template.kml + wpmz/waylines.wpml,
      well-formed XML, DJI WPML namespace, 2-200 waypoints, under 10 MB.
    * No backup, no change: the placeholder is copied to this PC and checked (it must open as a
      mission) before anything is written.
    * The file is overwritten in place (no delete step), then read back and compared by hash.
      If it doesn't match, the backup is put back automatically.
    * Every action is logged to Documents\Drone Mapping\send-log.txt.

  Restart the controller before (and after) sending so DJI Fly is fully closed: it caches missions
  and writes its old copy back over the file if it is still running. The thumbnail keeps showing the old
  route; open the mission to see the new one.

.PARAMETER Kmz
  The mission file to send. Defaults to the newest .kmz in your Downloads folder.
.PARAMETER Mission
  The placeholder's UUID. If omitted you are asked to choose.
.PARAMETER WhatIf
  Validate, list and back up, but change nothing on the controller.
.PARAMETER List
  Only list the controller's DJI Fly missions.
.PARAMETER Restore
  Put a backup .kmz (from Documents\Drone Mapping\backups) back onto the controller. The mission
  UUID is read from the backup's file name.
.PARAMETER Json
  For the Drone Mapping app: print one '##RESULT {json}' line and never prompt.

.EXAMPLE
  .\send-to-dji-fly.ps1
  .\send-to-dji-fly.ps1 -Kmz "$HOME\Downloads\Smith_farm.kmz" -WhatIf
  .\send-to-dji-fly.ps1 -Restore "$HOME\Documents\Drone Mapping\backups\<UUID>-20261001-114113.kmz"
#>
[CmdletBinding()]
param(
  [string]$Kmz,
  [string]$Mission,
  [switch]$WhatIf,
  [switch]$List,
  [string]$Restore,
  [switch]$Json
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$UUID_RE = '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$'
$DJI_FLY_PATH = @('Android', 'data', 'dji.go.v5', 'files', 'waypoint')
$dataDir = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Drone Mapping'
$backupDir = Join-Path $dataDir 'backups'
$logFile = Join-Path $dataDir 'send-log.txt'
New-Item -ItemType Directory -Force $backupDir | Out-Null

function Log($msg) { Add-Content -Path $logFile -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg" }
function Result($obj) { if ($Json) { Write-Output ('##RESULT ' + ($obj | ConvertTo-Json -Compress -Depth 4)) } }
function Say($msg) { if (-not $Json) { Write-Host $msg } }
function Fail($msg) {
  Log "FAILED: $msg"
  if ($Json) { Result @{ ok = $false; error = $msg } } else { Write-Host "`n$msg" -ForegroundColor Red }
  if ($script:tmp -and (Test-Path $script:tmp)) { Remove-Item -Recurse -Force $script:tmp }
  exit 1
}

# ---- Validate a mission file: returns the waypoint count or throws a plain-language reason ------
function Test-DjiFlyKmz([string]$path) {
  $info = Get-Item $path
  if ($info.Length -le 0 -or $info.Length -gt 10MB) { throw "file size $($info.Length) bytes is outside 1 B - 10 MB" }
  try { $zip = [IO.Compression.ZipFile]::OpenRead($path) } catch { throw "it isn't a valid KMZ (zip) file" }
  try {
    $files = @($zip.Entries | Where-Object { -not $_.FullName.EndsWith('/') })
    $names = ($files | ForEach-Object FullName | Sort-Object) -join '|'
    if ($names -ne 'wpmz/template.kml|wpmz/waylines.wpml') {
      throw "it should contain exactly wpmz/template.kml and wpmz/waylines.wpml, but has: $($names -replace '\|', ', ')"
    }
    $count = 0
    foreach ($e in $files) {
      $reader = New-Object IO.StreamReader($e.Open())
      try { $text = $reader.ReadToEnd() } finally { $reader.Dispose() }
      try { $null = [xml]$text } catch { throw "$($e.FullName) is not valid XML" }
      if ($text -notmatch 'xmlns:wpml="http://www\.(uav|dji)\.com/wpmz/') { throw "$($e.FullName) is not a DJI WPML file" }
      if ($e.FullName -eq 'wpmz/waylines.wpml') { $count = ([regex]::Matches($text, '<Placemark>')).Count }
    }
    if ($count -lt 1 -or $count -gt 200) { throw "it has $count waypoints; DJI Fly accepts up to 200" }
    return $count
  } finally { $zip.Dispose() }
}

# ---- Find the controller and DJI Fly's waypoint folder --------------------------------------
$shell = New-Object -ComObject Shell.Application
$script:tmp = Join-Path $env:TEMP "drone-mapping-$([guid]::NewGuid())"
New-Item -ItemType Directory $script:tmp | Out-Null

function Get-Child($folder, [string]$name) {
  return $folder.Items() | Where-Object { $_.Name -ceq $name } | Select-Object -First 1
}
function Copy-FromDevice($item, [string]$toDir) {
  New-Item -ItemType Directory -Force $toDir | Out-Null
  $shell.Namespace($toDir).CopyHere($item, 0x14)
  $target = Join-Path $toDir $item.Name
  for ($i = 0; $i -lt 150 -and -not (Test-Path $target); $i++) { Start-Sleep -Milliseconds 200 }
  Start-Sleep -Milliseconds 300
  if (-not (Test-Path $target)) { throw "couldn't read $($item.Name) from the controller" }
  return $target
}

# Only portable (MTP) devices that actually have DJI Fly's waypoint folder qualify.
$device = $null; $waypointDir = $null
foreach ($c in @($shell.Namespace(17).Items() | Where-Object { -not $_.IsFileSystem })) {
  $storage = $c.GetFolder.Items() | Select-Object -First 1
  if (-not $storage -or -not $storage.IsFolder) { continue }
  $f = $storage.GetFolder
  $found = $true
  foreach ($seg in $DJI_FLY_PATH) {
    $n = Get-Child $f $seg
    if (-not $n -or -not $n.IsFolder) { $found = $false; break }
    $f = $n.GetFolder
  }
  if ($found) { $device = $c; $waypointDir = $f; break }
}
if (-not $device) {
  Fail "No controller with DJI Fly found. Switch the controller ON, connect it with a data USB cable, and save at least one waypoint mission in DJI Fly."
}
Say "Controller:   $($device.Name)"

$missions = @($waypointDir.Items() | Where-Object { $_.IsFolder -and $_.Name -match $UUID_RE })

# ---- Inventory (read-only) -------------------------------------------------------------------
$rows = @()
for ($i = 0; $i -lt $missions.Count; $i++) {
  $m = $missions[$i]
  $item = Get-Child $m.GetFolder "$($m.Name).kmz"
  $count = 'none'
  if ($item) { try { $count = Test-DjiFlyKmz (Copy-FromDevice $item (Join-Path $script:tmp "peek$i")) } catch { $count = 'unreadable' } }
  $rows += [pscustomobject]@{ No = $i + 1; Mission = $m.Name; Waypoints = $count }
}
if ($List) {
  Remove-Item -Recurse -Force $script:tmp
  if ($Json) { Result @{ ok = $true; device = $device.Name; missions = @($rows | ForEach-Object { @{ id = $_.Mission; waypoints = $_.Waypoints } }) } }
  else { Say "`nDJI Fly missions:"; $rows | Format-Table -AutoSize | Out-Host }
  exit 0
}
if ($missions.Count -eq 0) { Fail "No DJI Fly missions on the controller. Save a short waypoint mission in DJI Fly to use as a placeholder." }

# ---- What are we sending? (validated before the controller is touched) -----------------------
if ($Restore) {
  if (-not (Test-Path $Restore)) { Fail "Can't find backup $Restore" }
  $Kmz = (Resolve-Path $Restore).Path
  $Mission = ([IO.Path]::GetFileNameWithoutExtension($Kmz)) -replace '-\d{8}-\d{6}$', ''
  if ($Mission -notmatch $UUID_RE) { Fail "Can't tell which mission $(Split-Path $Kmz -Leaf) belongs to (expected <UUID>-<date>-<time>.kmz)." }
} elseif (-not $Kmz) {
  $latest = Get-ChildItem (Join-Path $HOME 'Downloads') -Filter *.kmz -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $latest) { Fail "No .kmz in Downloads. Download one from Send to drone first, or pass -Kmz <file>." }
  $Kmz = $latest.FullName
}
if (-not (Test-Path $Kmz)) { Fail "Can't find $Kmz" }
$Kmz = (Resolve-Path $Kmz).Path
try { $newCount = Test-DjiFlyKmz $Kmz } catch { Fail "Refusing to send $(Split-Path $Kmz -Leaf): $($_.Exception.Message). Nothing was changed." }
Say "Mission file: $Kmz ($newCount waypoints)"

# ---- Which placeholder? ------------------------------------------------------------------------
if (-not $Json) { Say "`nDJI Fly missions on the controller:"; $rows | Format-Table -AutoSize | Out-Host }
if ($Mission) {
  if ($Mission -notmatch $UUID_RE) { Fail "$Mission is not a DJI Fly mission id." }
  $target = $missions | Where-Object { $_.Name -ieq $Mission } | Select-Object -First 1
  if (-not $target) { Fail "Mission $Mission isn't on the controller." }
} elseif ($missions.Count -eq 1) {
  $target = $missions[0]
  Say "Only one mission, so that's the placeholder: $($target.Name)"
} elseif ($Json) {
  Fail 'Choose which placeholder mission to replace.'
} else {
  $pick = Read-Host "Which mission is the placeholder to replace? (1-$($missions.Count))"
  if (-not ($pick -as [int]) -or [int]$pick -lt 1 -or [int]$pick -gt $missions.Count) { Fail 'Cancelled.' }
  $target = $missions[[int]$pick - 1]
}
$uuid = $target.Name
$fileName = "$uuid.kmz"
$targetDir = $target.GetFolder
$oldItem = Get-Child $targetDir $fileName
if (-not $oldItem) { Fail "Mission $uuid has no $fileName. Open and save it once in DJI Fly, then try again." }

# ---- Backup: mandatory and verified -------------------------------------------------------------
$stamp = Get-Date -Format yyyyMMdd-HHmmss
try {
  $copied = Copy-FromDevice $oldItem (Join-Path $script:tmp 'backup')
  $backupCount = Test-DjiFlyKmz $copied
} catch { Fail "Couldn't make a verified backup of the placeholder ($($_.Exception.Message)). Nothing was changed." }
$backup = Join-Path $backupDir "$uuid-$stamp.kmz"
Move-Item $copied $backup
$backupHash = (Get-FileHash $backup).Hash
Log "Backup: $($device.Name) mission $uuid ($backupCount waypoints) -> $backup [$backupHash]"
Say "Backed up the placeholder ($backupCount waypoints) to $backup"

if ($WhatIf) {
  Say "`n-WhatIf: would replace $fileName with $(Split-Path $Kmz -Leaf). Nothing on the controller was changed."
  Log "WhatIf: would send $Kmz to $uuid"
  Remove-Item -Recurse -Force $script:tmp
  Result @{ ok = $true; whatIf = $true; mission = $uuid; waypoints = $newCount; backup = $backup }
  exit 0
}

# ---- Write ---------------------------------------------------------------------------------------
# Windows silently skips overwriting an existing file on an MTP device (tested on an RC 2), and a
# plain delete can raise a confirmation dialog nobody can answer. So: MOVE the old file off the
# controller into an empty folder on this PC (it leaves the device, no prompt, and doubles as a
# second backup), then copy the new one in. Every destination is a fresh empty folder, so Windows
# never has a name clash to ask about.
function New-EmptyDir() {
  $d = Join-Path $script:tmp ([guid]::NewGuid()); New-Item -ItemType Directory $d | Out-Null; return $d
}
function Remove-FromDevice() {
  $item = Get-Child $targetDir $fileName
  if (-not $item) { return $null }
  $dir = New-EmptyDir
  $shell.Namespace($dir).MoveHere($item, 0x14)
  for ($i = 0; $i -lt 100 -and (Get-Child $targetDir $fileName); $i++) { Start-Sleep -Milliseconds 200 }
  if (Get-Child $targetDir $fileName) { throw "the old file couldn't be moved off the controller" }
  $moved = Join-Path $dir $fileName
  for ($i = 0; $i -lt 50 -and -not (Test-Path $moved); $i++) { Start-Sleep -Milliseconds 200 }
  return $moved
}
function Put-File([string]$source) {
  $staged = Join-Path (New-EmptyDir) $fileName
  Copy-Item $source $staged
  $targetDir.CopyHere($staged, 0x14)
  for ($i = 0; $i -lt 100 -and -not (Get-Child $targetDir $fileName); $i++) { Start-Sleep -Milliseconds 200 }
  Start-Sleep -Seconds 1
}
function Get-DeviceHash() {
  $item = Get-Child $targetDir $fileName
  if (-not $item) { return $null }
  try { return (Get-FileHash (Copy-FromDevice $item (New-EmptyDir))).Hash } catch { return $null }
}
function Restore-Backup() {
  try { if (Get-Child $targetDir $fileName) { $null = Remove-FromDevice } } catch { return $false }
  Put-File $backup
  return ((Get-DeviceHash) -eq $backupHash)
}

$wantHash = (Get-FileHash $Kmz).Hash
Log "Send: $Kmz [$wantHash] -> $($device.Name) $uuid"

# Step 1: take the old file off the controller (and check it's the one we backed up).
try { $movedOff = Remove-FromDevice } catch { Fail "Couldn't remove the old mission file ($($_.Exception.Message)). Nothing was changed." }
if (-not $movedOff -or -not (Test-Path $movedOff) -or (Get-FileHash $movedOff).Hash -ne $backupHash) {
  # The file left the device but the copy we got doesn't match the backup: put the verified backup back.
  Log 'Moved-off file did not match the backup; restoring the backup.'
  $ok = Restore-Backup
  Fail $(if ($ok) { "Something changed the mission while sending, so the original was put back. Close DJI Fly and try again." }
         else { "Couldn't put the original back automatically. Run: .\send-to-dji-fly.ps1 -Restore `"$backup`"" })
}
Log "Old file moved off the controller (matches backup)."

# Step 2: copy the new file in and verify it byte for byte.
Put-File $Kmz
$gotHash = Get-DeviceHash
if ($gotHash -ne $wantHash) {
  Log "Verify failed (got $gotHash). Restoring backup."
  $restored = Restore-Backup
  Log $(if ($restored) { 'Backup restored and verified.' } else { "RESTORE FAILED - backup kept at $backup" })
  if ($restored) { Fail "The mission didn't copy correctly, so the original was put back. Nothing changed. Try again." }
  Fail "The mission didn't copy correctly and the original couldn't be put back automatically. Run: .\send-to-dji-fly.ps1 -Restore `"$backup`""
}

Remove-Item -Recurse -Force $script:tmp
Log "OK: $uuid now holds $newCount waypoints"
Say "`nDone. Mission $uuid now holds $newCount waypoints."
Say "Unplug, open DJI Fly, and open that mission (its thumbnail still shows the old route until you do)."
Say "Check the route, heights and lost-signal action before take-off."
Result @{ ok = $true; mission = $uuid; waypoints = $newCount; backup = $backup; restored = [bool]$Restore }
