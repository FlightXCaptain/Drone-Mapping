//! Find flight photos on whatever is plugged in: an SD card or drone that shows up as a drive
//! (E:\DCIM\...), or a DJI drone / controller connected over USB (MTP, like the RC 2 for sending).
//!
//! Drives are read in place. MTP devices can't be read as files, so a chosen folder is first
//! imported into Documents\Drone Mapping\Imports with the Windows Shell, waiting for every copy
//! to really finish (Shell copies are asynchronous; see tools/send-to-dji-fly.ps1).

use serde_json::{json, Value};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::{AppHandle, Emitter, Manager};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn is_jpeg(p: &Path) -> bool {
    matches!(p.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).as_deref(), Some("jpg" | "jpeg"))
}

/// JPEGs directly in DCIM and in each of its sub-folders (DJI_001, 100MEDIA, ...).
fn count_dcim(dcim: &Path) -> usize {
    let Ok(entries) = fs::read_dir(dcim) else { return 0 };
    entries
        .flatten()
        .map(|e| e.path())
        .map(|p| {
            if p.is_dir() {
                fs::read_dir(&p).map(|it| it.flatten().filter(|e| is_jpeg(&e.path())).count()).unwrap_or(0)
            } else {
                usize::from(is_jpeg(&p))
            }
        })
        .sum()
}

fn drive_sources() -> Vec<Value> {
    let system = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into()).to_ascii_uppercase();
    (b'D'..=b'Z')
        .map(|l| format!("{}:", l as char))
        .filter(|d| *d != system)
        .filter_map(|d| {
            let dcim = PathBuf::from(format!("{d}\\DCIM"));
            if !dcim.is_dir() {
                return None;
            }
            let photos = count_dcim(&dcim);
            (photos > 0).then(|| {
                json!({
                    "id": format!("drive:{d}"),
                    "kind": "drive",
                    "label": format!("Card or drive {d}"),
                    "path": dcim.to_string_lossy(),
                    "photos": photos,
                })
            })
        })
        .collect()
}

/// DJI devices over USB, their DCIM folders and how many JPEGs each holds.
const MTP_LIST_PS: &str = r#"
$ErrorActionPreference = 'SilentlyContinue'
$out = @()
$shell = New-Object -ComObject Shell.Application
foreach ($dev in $shell.Namespace(17).Items()) {
  if ($dev.IsFileSystem -or $dev.Name -notmatch 'DJI') { continue }
  foreach ($storage in $dev.GetFolder.Items()) {
    $dcim = $storage.GetFolder.Items() | Where-Object { $_.IsFolder -and $_.Name -eq 'DCIM' } | Select-Object -First 1
    if (-not $dcim) { continue }
    foreach ($f in $dcim.GetFolder.Items()) {
      if (-not $f.IsFolder) { continue }
      $n = @($f.GetFolder.Items() | Where-Object { -not $_.IsFolder -and ([string]$_.ExtendedProperty('System.FileName')) -match '\.jpe?g$' }).Count
      if ($n -gt 0) { $out += @{ device = $dev.Name; storage = $storage.Name; folder = $f.Name; photos = $n } }
    }
  }
}
ConvertTo-Json -Compress -Depth 3 @($out)
"#;

fn powershell(script: &str) -> Command {
    let mut cmd = Command::new("powershell.exe");
    cmd.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script]);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

fn mtp_sources() -> Vec<Value> {
    let Ok(out) = powershell(MTP_LIST_PS).output() else { return vec![] };
    let parsed: Value = serde_json::from_slice(&out.stdout).unwrap_or(json!([]));
    let list = if parsed.is_array() { parsed.as_array().cloned().unwrap_or_default() } else { vec![parsed] };
    // Windows can list a device's storages twice; keep one of each.
    let mut seen = std::collections::HashSet::new();
    list.into_iter()
        .filter(|v| v["photos"].as_u64().unwrap_or(0) > 0)
        .filter(|v| seen.insert(format!("{}|{}|{}", v["device"], v["storage"], v["folder"])))
        .map(|v| {
            let (device, storage, folder) = (v["device"].as_str().unwrap_or(""), v["storage"].as_str().unwrap_or(""), v["folder"].as_str().unwrap_or(""));
            json!({
                "id": format!("mtp:{device}|{storage}|{folder}"),
                "kind": "mtp",
                "label": format!("{device} · {} · {folder}", if storage.eq_ignore_ascii_case("disk") || storage.to_ascii_lowercase().contains("sd") { "SD card" } else { storage }),
                "device": device, "storage": storage, "folder": folder,
                "photos": v["photos"],
            })
        })
        .collect()
}

/// Photo sources that are connected now. `usb` also asks DJI USB devices (a second or two).
#[tauri::command]
pub async fn photo_sources(usb: bool) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut sources = drive_sources();
        if usb && cfg!(windows) {
            sources.extend(mtp_sources());
        }
        json!({ "ok": true, "sources": sources })
    })
    .await
    .map_err(|e| e.to_string())
}

/// Copy one DCIM folder's JPEGs off a DJI USB device, reporting "##PROGRESS n/total" lines.
/// The device, storage and folder are matched by name, never built into a path.
const MTP_IMPORT_PS: &str = r###"
$ErrorActionPreference = 'Stop'
# Passed as environment variables: names with spaces or quotes can't break the script.
$device = $env:DM_DEVICE; $storage = $env:DM_STORAGE; $folder = $env:DM_FOLDER; $dest = $env:DM_DEST
$shell = New-Object -ComObject Shell.Application
$dev = $shell.Namespace(17).Items() | Where-Object { -not $_.IsFileSystem -and $_.Name -eq $device } | Select-Object -First 1
if (-not $dev) { throw "$device isn't connected any more." }
$st = $dev.GetFolder.Items() | Where-Object { $_.Name -eq $storage } | Select-Object -First 1
$dcim = $st.GetFolder.Items() | Where-Object { $_.IsFolder -and $_.Name -eq 'DCIM' } | Select-Object -First 1
$src = $dcim.GetFolder.Items() | Where-Object { $_.IsFolder -and $_.Name -eq $folder } | Select-Object -First 1
if (-not $src) { throw "Folder $folder wasn't found on $device." }
$items = @($src.GetFolder.Items() | Where-Object { -not $_.IsFolder -and ([string]$_.ExtendedProperty('System.FileName')) -match '\.jpe?g$' })
$total = $items.Count
New-Item -ItemType Directory -Force $dest | Out-Null
$target = $shell.Namespace($dest)
$have = @{}; Get-ChildItem -LiteralPath $dest -File | ForEach-Object { $have[$_.Name] = $_.Length }
$i = 0
foreach ($it in $items) {
  $i++
  $name = [string]$it.ExtendedProperty('System.FileName'); if (-not $name) { $name = $it.Name }
  $size = [int64]$it.ExtendedProperty('System.Size')
  if ($have.ContainsKey($name) -and ($size -le 0 -or $have[$name] -eq $size)) { "##PROGRESS $i/$total"; continue }
  # 0x14 = no progress UI, yes to all. The copy is asynchronous: wait until the file is complete.
  $target.CopyHere($it, 0x14)
  $path = Join-Path $dest $name
  $deadline = (Get-Date).AddSeconds(120); $last = -1
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 150
    if (-not (Test-Path -LiteralPath $path)) { continue }
    $len = (Get-Item -LiteralPath $path).Length
    if (($size -gt 0 -and $len -ge $size) -or ($size -le 0 -and $len -gt 0 -and $len -eq $last)) {
      try { [IO.File]::Open($path, 'Open', 'Read', 'None').Close(); break } catch { }
    }
    $last = $len
  }
  if (-not (Test-Path -LiteralPath $path)) { throw "Timed out copying $name (try another USB port or cable)." }
  "##PROGRESS $i/$total"
}
"##DONE $total"
"###;

fn imports_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .document_dir()
        .map(|d| d.join("Drone Mapping").join("Imports"))
        .map_err(|e| format!("Couldn't find the Documents folder: {e}"))
}

fn safe_name(s: &str) -> String {
    let s: String = s.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' }).collect();
    s.trim_matches('-').chars().take(40).collect()
}

#[tauri::command]
pub async fn photos_import(app: AppHandle, device: String, storage: String, folder: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let fail = |e: String| json!({ "ok": false, "error": e });
        let root = match imports_root(&app) {
            Ok(r) => r,
            Err(e) => return fail(e),
        };
        // One folder per device folder, so importing again only fetches new photos.
        let dest = root.join(format!("{}-{}-{}", safe_name(&device), safe_name(&storage), safe_name(&folder)));
        let dest_s = dest.to_string_lossy().to_string();
        let mut child = match powershell(MTP_IMPORT_PS)
            .env("DM_DEVICE", &device)
            .env("DM_STORAGE", &storage)
            .env("DM_FOLDER", &folder)
            .env("DM_DEST", &dest_s)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
        {
            Ok(c) => c,
            Err(e) => return fail(format!("Couldn't start the import: {e}")),
        };
        let stdout = child.stdout.take().unwrap();
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some((done, total)) = line.strip_prefix("##PROGRESS ").and_then(|r| r.split_once('/')) {
                let _ = app.emit("import-progress", json!({ "done": done.parse::<u64>().unwrap_or(0), "total": total.trim().parse::<u64>().unwrap_or(0) }));
            }
        }
        let mut err = String::new();
        if let Some(mut e) = child.stderr.take() {
            let _ = std::io::Read::read_to_string(&mut e, &mut err);
        }
        match child.wait() {
            Ok(s) if s.success() => json!({ "ok": true, "folder": dest_s }),
            _ => {
                let detail: String = err.lines().map(str::trim).filter(|l| !l.is_empty()).take(2).collect::<Vec<_>>().join(" ");
                fail(if detail.is_empty() { "The import stopped. Check the USB connection and try again.".into() } else { detail })
            }
        }
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn import_folder_names_are_safe() {
        assert_eq!(safe_name("DJI Mini 4 Pro"), "DJI-Mini-4-Pro");
        assert_eq!(safe_name("..\\..\\Windows"), "Windows");
        assert_eq!(safe_name("DJI_001"), "DJI_001");
    }

    #[test]
    fn counts_jpegs_in_dcim_subfolders() {
        let dcim = std::env::temp_dir().join(format!("dm-dcim-{}", std::process::id())).join("DCIM");
        fs::create_dir_all(dcim.join("DJI_001")).unwrap();
        for n in ["DJI_0001.JPG", "DJI_0002.jpg", "DJI_0003.MP4"] {
            fs::write(dcim.join("DJI_001").join(n), b"x").unwrap();
        }
        assert_eq!(count_dcim(&dcim), 2);
        let _ = fs::remove_dir_all(dcim.parent().unwrap());
    }
}
