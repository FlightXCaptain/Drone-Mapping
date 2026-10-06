//! Optional processing tools (photogrammetry, Gaussian splats), installed on request.
//!
//! The MSI stays small. Each pack is downloaded from the engine's own GitHub release, pinned to
//! an exact version, size and SHA-256, so a truncated or tampered download is never installed.
//! Packs live in %LOCALAPPDATA%\<app id>\engines\<pack>, outside the program folder, so
//! updating or reinstalling the app keeps them.

use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

enum Kind {
    /// A zip extracted as-is.
    Zip,
    /// An Inno Setup installer, run silently into our folder (it registers its own uninstaller).
    InnoSetup,
}

struct Download {
    url: &'static str,
    sha256: &'static str,
    bytes: u64,
    kind: Kind,
    /// Sub-folder of the pack it installs into.
    dir: &'static str,
    /// Size once installed, for the install progress bar.
    installed_bytes: u64,
}

struct Pack {
    id: &'static str,
    title: &'static str,
    summary: &'static str,
    /// Bumping this makes installed copies show "update available".
    version: &'static str,
    downloads: &'static [Download],
    /// Disk space needed once installed (bytes, rounded up).
    installed_bytes: u64,
    /// Files that must exist for the pack to count as installed.
    checks: &'static [&'static str],
}

const MB: u64 = 1024 * 1024;

const PACKS: &[Pack] = &[
    Pack {
        id: "photogrammetry",
        title: "Maps & 3D models",
        summary: "OpenDroneMap: orthophoto maps, elevation models, point clouds and textured 3D meshes.",
        version: "odm-3.6.2",
        downloads: &[Download {
            url: "https://github.com/OpenDroneMap/ODM/releases/download/v3.6.2/ODM_Setup_3.6.2.exe",
            sha256: "c9dbfabf0d066529a7b6c753fd45bf3366a0314266160cd677373bab4caff294",
            bytes: 244_864_104,
            kind: Kind::InnoSetup,
            dir: "odm",
            installed_bytes: 1_006_000_000, // measured for 3.6.2
        }],
        installed_bytes: 1_100 * MB, // 960 MB measured for 3.6.2
        checks: &["odm/run.bat", "odm/run.py"],
    },
    Pack {
        id: "splats",
        title: "Gaussian splats",
        summary: "COLMAP works out where each photo was taken; Brush trains the splat on your graphics card.",
        version: "colmap-4.2.1+brush-0.3.0",
        downloads: &[
            Download {
                url: "https://github.com/colmap/colmap/releases/download/4.2.1/colmap-x64-windows-nocuda.zip",
                sha256: "c493d88cb4a43f21afba42cb55bf786e5434a0420e73db0ba1454c5d8b3686ae",
                bytes: 127_731_595,
                kind: Kind::Zip,
                dir: "colmap",
                installed_bytes: 355_245_654,
            },
            Download {
                url: "https://github.com/ArthurBrussee/brush/releases/download/v0.3.0/brush-app-x86_64-pc-windows-msvc.zip",
                sha256: "b68e3e9cf052d51bf3ee30776fa5a364de7f2ba13b58443128ff797bb7bcfcd6",
                bytes: 158_791_348,
                kind: Kind::Zip,
                dir: "brush",
                installed_bytes: 158_790_940,
            },
        ],
        installed_bytes: 550 * MB,
        checks: &["colmap/bin/colmap.exe", "brush/brush_app.exe"],
    },
];

/// One install or removal at a time; `cancel` stops a download in progress.
#[derive(Default, Clone)]
pub struct EngineState {
    busy: Arc<Mutex<()>>,
    cancel: Arc<AtomicBool>,
}

#[derive(Serialize, Clone)]
struct Progress {
    pack: &'static str,
    /// "download" | "verify" | "install" | "done" | "error"
    step: &'static str,
    done: u64,
    total: u64,
    message: String,
}

const MARKER: &str = "installed.json";

fn root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|d| d.join("engines"))
        .map_err(|e| format!("Couldn't find the app's data folder: {e}"))
}

fn find(id: &str) -> Result<&'static Pack, String> {
    PACKS.iter().find(|p| p.id == id).ok_or_else(|| format!("Unknown processing pack '{id}'."))
}

/// The version recorded when the pack last installed completely, if its files are still there.
fn installed_version(dir: &Path, pack: &Pack) -> Option<String> {
    let marker: Value = serde_json::from_str(&fs::read_to_string(dir.join(MARKER)).ok()?).ok()?;
    if !pack.checks.iter().all(|c| dir.join(c).is_file()) {
        return None;
    }
    marker["version"].as_str().map(str::to_string)
}

/// The folder of an installed, complete pack, for running its tools.
pub fn installed_pack(app: &AppHandle, id: &str) -> Option<PathBuf> {
    let pack = find(id).ok()?;
    let dir = root(app).ok()?.join(pack.id);
    installed_version(&dir, pack).map(|_| dir)
}

#[tauri::command]
pub fn engine_status(app: AppHandle) -> Value {
    let root = match root(&app) {
        Ok(r) => r,
        Err(e) => return json!({ "ok": false, "error": e }),
    };
    let free = fs4::available_space(existing_ancestor(&root)).ok();
    let packs: Vec<Value> = PACKS
        .iter()
        .map(|p| {
            let dir = root.join(p.id);
            let have = installed_version(&dir, p);
            json!({
                "id": p.id,
                "title": p.title,
                "summary": p.summary,
                "version": p.version,
                "installedVersion": have,
                "installed": have.is_some(),
                "upToDate": have.as_deref() == Some(p.version),
                "downloadBytes": p.downloads.iter().map(|d| d.bytes).sum::<u64>(),
                "installedBytes": p.installed_bytes,
                "path": dir.to_string_lossy(),
            })
        })
        .collect();
    json!({ "ok": true, "windows": cfg!(windows), "freeBytes": free, "packs": packs })
}

fn existing_ancestor(p: &Path) -> &Path {
    p.ancestors().find(|a| a.exists()).unwrap_or(p)
}

#[tauri::command]
pub fn engine_cancel(state: State<'_, EngineState>) {
    state.cancel.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub async fn engine_install(app: AppHandle, state: State<'_, EngineState>, id: String) -> Result<Value, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let Ok(_guard) = state.busy.try_lock() else {
            return json!({ "ok": false, "error": "Another processing pack is installing. Wait for it to finish." });
        };
        state.cancel.store(false, Ordering::SeqCst);
        match install(&app, &state.cancel, &id) {
            Ok(()) => json!({ "ok": true }),
            Err(e) => {
                let pack = find(&id).map(|p| p.id).unwrap_or("unknown");
                let _ = app.emit("engine-progress", Progress { pack, step: "error", done: 0, total: 0, message: e.clone() });
                json!({ "ok": false, "error": e })
            }
        }
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn engine_remove(app: AppHandle, state: State<'_, EngineState>, id: String) -> Result<Value, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let Ok(_guard) = state.busy.try_lock() else {
            return json!({ "ok": false, "error": "A processing pack is installing. Wait for it to finish." });
        };
        let result = find(&id).and_then(|p| Ok((p, root(&app)?))).and_then(|(p, root)| remove_pack(&root.join(p.id), p));
        match result {
            Ok(()) => json!({ "ok": true }),
            Err(e) => json!({ "ok": false, "error": e }),
        }
    })
    .await
    .map_err(|e| e.to_string())
}

fn install(app: &AppHandle, cancel: &AtomicBool, id: &str) -> Result<(), String> {
    if !cfg!(windows) {
        return Err("Processing packs need Windows.".into());
    }
    let pack = find(id)?;
    let root = root(app)?;
    let dir = root.join(pack.id);
    let downloads = root.join("downloads");
    fs::create_dir_all(&downloads).map_err(|e| format!("Couldn't create {}: {e}", downloads.display()))?;

    let need: u64 = pack.downloads.iter().map(|d| d.bytes).sum::<u64>() + pack.installed_bytes;
    if let Ok(free) = fs4::available_space(&root)
        && free < need
    {
        return Err(format!(
            "Not enough disk space: this needs about {:.1} GB free and the drive has {:.1} GB.",
            need as f64 / 1e9,
            free as f64 / 1e9
        ));
    }

    // Replace any older or half-finished copy, so nothing stale mixes with the new files.
    if dir.exists() {
        remove_pack(&dir, pack)?;
    }

    let emit = |step, done, total, message: String| {
        let _ = app.emit("engine-progress", Progress { pack: pack.id, step, done, total, message });
    };
    let total: u64 = pack.downloads.iter().map(|d| d.bytes).sum();
    let mut before = 0;
    let mut files = Vec::new();
    for d in pack.downloads {
        let name = d.url.rsplit('/').next().unwrap_or("download");
        let file = downloads.join(name);
        fetch(d, &file, cancel, |got| emit("download", before + got, total, format!("Downloading {name}")))?;
        before += d.bytes;
        files.push(file);
    }

    let result = (|| {
        for (d, file) in pack.downloads.iter().zip(&files) {
            let message = format!("Installing {}", d.dir);
            let progress = |done, total| emit("install", done, total, message.clone());
            progress(0, 1);
            let target = dir.join(d.dir);
            match d.kind {
                Kind::Zip => unzip(file, &target, progress)?,
                Kind::InnoSetup => run_inno(file, &target, d.installed_bytes, progress)?,
            }
        }
        if let Some(missing) = pack.checks.iter().find(|c| !dir.join(c).is_file()) {
            return Err(format!("The install finished but {missing} is missing."));
        }
        let marker = json!({ "version": pack.version, "installedAt": unix_now() });
        fs::write(dir.join(MARKER), marker.to_string()).map_err(|e| format!("Couldn't record the install: {e}"))
    })();
    for f in &files {
        let _ = fs::remove_file(f);
    }
    if let Err(e) = result {
        let _ = remove_pack(&dir, pack);
        return Err(e);
    }
    emit("done", 1, 1, format!("{} installed", pack.title));
    Ok(())
}

/// Stream a download to disk, checking its size and SHA-256 before it's used.
fn fetch(d: &Download, file: &Path, cancel: &AtomicBool, progress: impl Fn(u64)) -> Result<(), String> {
    let part = file.with_extension("part");
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .timeout(None)
        .user_agent(concat!("DroneMapping/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())?;
    let mut res = client
        .get(d.url)
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("Couldn't download {}: {e}. Check the internet connection.", d.url))?;
    let mut out = File::create(&part).map_err(|e| format!("Couldn't write {}: {e}", part.display()))?;
    let mut hash = Sha256::new();
    let mut buf = vec![0u8; 256 * 1024];
    let (mut got, mut last) = (0u64, Instant::now());
    loop {
        if cancel.load(Ordering::SeqCst) {
            drop(out);
            let _ = fs::remove_file(&part);
            return Err("Cancelled.".into());
        }
        let n = res.read(&mut buf).map_err(|e| format!("The download stopped: {e}"))?;
        if n == 0 {
            break;
        }
        out.write_all(&buf[..n]).map_err(|e| format!("Couldn't write the download: {e}"))?;
        hash.update(&buf[..n]);
        got += n as u64;
        if last.elapsed() > Duration::from_millis(200) {
            progress(got);
            last = Instant::now();
        }
    }
    drop(out);
    progress(got);
    let digest: String = hash.finalize().iter().map(|b| format!("{b:02x}")).collect();
    if got != d.bytes || digest != d.sha256 {
        let _ = fs::remove_file(&part);
        return Err(format!(
            "The download of {} didn't match the expected file ({got} bytes). Nothing was installed; try again.",
            d.url.rsplit('/').next().unwrap_or("")
        ));
    }
    fs::rename(&part, file).map_err(|e| e.to_string())
}

fn unzip(file: &Path, target: &Path, progress: impl Fn(u64, u64)) -> Result<(), String> {
    let mut zip = zip::ZipArchive::new(File::open(file).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let total = (0..zip.len()).filter_map(|i| zip.by_index_raw(i).ok().map(|e| e.size())).sum::<u64>().max(1);
    let (mut done, mut last) = (0u64, Instant::now());
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        // enclosed_name refuses absolute paths and "..", so an entry can't escape the folder.
        let Some(rel) = entry.enclosed_name() else { continue };
        let path = target.join(rel);
        if entry.is_dir() {
            fs::create_dir_all(&path).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut out = File::create(&path).map_err(|e| format!("Couldn't write {}: {e}", path.display()))?;
        done += std::io::copy(&mut entry, &mut out).map_err(|e| format!("Couldn't extract {}: {e}", path.display()))?;
        if last.elapsed() > Duration::from_millis(200) {
            progress(done, total);
            last = Instant::now();
        }
    }
    progress(total, total);
    Ok(())
}

/// The installer reports nothing while it runs, so progress is how much of the expected size
/// has landed in the folder so far.
fn run_inno(installer: &Path, target: &Path, expected: u64, progress: impl Fn(u64, u64)) -> Result<(), String> {
    let mut cmd = Command::new(installer);
    cmd.args(["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/NOICONS", "/CURRENTUSER", "/SP-"])
        .arg(format!("/DIR={}", target.display()));
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let mut child = cmd.spawn().map_err(|e| format!("Couldn't start the installer: {e}. If Windows blocked it, allow it and try again."))?;
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break status;
        }
        progress(dir_size(target).min(expected * 99 / 100), expected);
        std::thread::sleep(Duration::from_secs(1));
    };
    progress(expected, expected);
    if !status.success() {
        return Err(format!("The installer stopped (code {}).", status.code().unwrap_or(-1)));
    }
    Ok(())
}

/// Run the pack's own uninstallers (so Windows forgets them too), then delete the folder.
fn remove_pack(dir: &Path, pack: &Pack) -> Result<(), String> {
    for d in pack.downloads.iter().filter(|d| matches!(d.kind, Kind::InnoSetup)) {
        let uninstaller = dir.join(d.dir).join("unins000.exe");
        if uninstaller.is_file() {
            let mut cmd = Command::new(&uninstaller);
            cmd.args(["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART"]);
            #[cfg(windows)]
            cmd.creation_flags(CREATE_NO_WINDOW);
            let _ = cmd.status();
            // The uninstaller copies itself to %TEMP% and finishes in the background.
            for _ in 0..60 {
                if !uninstaller.exists() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(500));
            }
        }
    }
    if dir.exists() {
        fs::remove_dir_all(dir).map_err(|e| format!("Couldn't remove {}: {e}. Close anything using it and try again.", dir.display()))?;
    }
    Ok(())
}

fn dir_size(dir: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(dir) else { return 0 };
    entries
        .flatten()
        .map(|e| match e.file_type() {
            Ok(t) if t.is_dir() => dir_size(&e.path()),
            Ok(_) => e.metadata().map(|m| m.len()).unwrap_or(0),
            Err(_) => 0,
        })
        .sum()
}

fn unix_now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packs_are_pinned() {
        for p in PACKS {
            assert!(!p.checks.is_empty(), "{} has no install checks", p.id);
            for d in p.downloads {
                assert!(d.url.starts_with("https://github.com/"), "{}", d.url);
                assert_eq!(d.sha256.len(), 64);
                assert!(d.sha256.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
                assert!(d.bytes > 0);
            }
        }
    }

    #[test]
    fn unzip_keeps_entries_inside_the_folder() {
        let tmp = std::env::temp_dir().join(format!("dm-unzip-{}", unix_now()));
        fs::create_dir_all(&tmp).unwrap();
        let zip_path = tmp.join("t.zip");
        {
            let mut w = zip::ZipWriter::new(File::create(&zip_path).unwrap());
            let o = zip::write::SimpleFileOptions::default();
            w.start_file("bin/ok.txt", o).unwrap();
            w.write_all(b"ok").unwrap();
            w.start_file("../escape.txt", o).unwrap();
            w.write_all(b"bad").unwrap();
            w.finish().unwrap();
        }
        let target = tmp.join("out");
        unzip(&zip_path, &target, |_, _| {}).unwrap();
        assert_eq!(fs::read_to_string(target.join("bin/ok.txt")).unwrap(), "ok");
        assert!(!tmp.join("escape.txt").exists());
        let _ = fs::remove_dir_all(&tmp);
    }
}
