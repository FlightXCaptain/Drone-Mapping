//! Turn flight photos into results with the installed processing packs (see engines.rs).
//!
//! A job is a folder under Documents\Drone Mapping\Processing holding a copy of the photos,
//! the engine's working files, `log.txt` and `job.json` (name, kind, status, outputs). One job
//! runs at a time, since each engine uses the whole machine. Jobs keep running while the
//! dialog is closed, and are stopped if the app exits.

use serde::Serialize;
use serde_json::{json, Value};
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Default, Clone)]
pub struct JobState {
    running: Arc<Mutex<Option<Running>>>,
}

#[derive(Clone)]
struct Running {
    id: String,
    name: String,
    kind: String,
    cancel: Arc<AtomicBool>,
    pid: Arc<Mutex<Option<u32>>>,
}

#[derive(Serialize, Clone)]
struct Progress {
    id: String,
    name: String,
    kind: String,
    stage: String,
    /// Overall 0–100.
    pct: f64,
    line: String,
}

fn root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .document_dir()
        .map(|d| d.join("Drone Mapping").join("Processing"))
        .map_err(|e| format!("Couldn't find the Documents folder: {e}"))
}

/// Job ids are folder names we made: letters, digits, '-' and '_' only, so never a path.
fn is_job_id(s: &str) -> bool {
    !s.is_empty() && s.len() <= 80 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn job_dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    if !is_job_id(id) {
        return Err("Unknown job.".into());
    }
    let dir = root(app)?.join(id);
    if dir.join("job.json").is_file() { Ok(dir) } else { Err("That result no longer exists.".into()) }
}

fn slug(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    let s: String = s.chars().take(40).collect();
    if s.is_empty() { "photos".into() } else { s }
}

fn read_job(dir: &Path) -> Option<Value> {
    serde_json::from_str(&fs::read_to_string(dir.join("job.json")).ok()?).ok()
}

fn write_job(dir: &Path, job: &Value) {
    let _ = fs::write(dir.join("job.json"), serde_json::to_string_pretty(job).unwrap_or_default());
}

fn unix_now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/* ---------------------------------------------------------------- photos ---------- */

fn is_photo(p: &Path) -> bool {
    matches!(p.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).as_deref(), Some("jpg" | "jpeg"))
}

fn collect_photos(dir: &Path, depth: u32, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    let mut entries: Vec<_> = entries.flatten().map(|e| e.path()).collect();
    entries.sort();
    for p in entries {
        if out.len() >= 5000 {
            return;
        }
        if p.is_dir() {
            if depth > 0 {
                collect_photos(&p, depth - 1, out);
            }
        } else if is_photo(&p) {
            out.push(p);
        }
    }
}

fn gps_degrees(exif: &exif::Exif, tag: exif::Tag, ref_tag: exif::Tag, negative: &str) -> Option<f64> {
    let f = exif.get_field(tag, exif::In::PRIMARY)?;
    let exif::Value::Rational(v) = &f.value else { return None };
    if v.len() < 3 {
        return None;
    }
    let deg = v[0].to_f64() + v[1].to_f64() / 60.0 + v[2].to_f64() / 3600.0;
    let sign = match exif.get_field(ref_tag, exif::In::PRIMARY) {
        Some(r) if r.display_value().to_string().trim_matches('"').eq_ignore_ascii_case(negative) => -1.0,
        _ => 1.0,
    };
    Some(sign * deg)
}

fn read_photo(path: &Path) -> Option<Value> {
    let file = File::open(path).ok()?;
    let exif = exif::Reader::new().read_from_container(&mut BufReader::new(file)).ok()?;
    let lat = gps_degrees(&exif, exif::Tag::GPSLatitude, exif::Tag::GPSLatitudeRef, "S")?;
    let lng = gps_degrees(&exif, exif::Tag::GPSLongitude, exif::Tag::GPSLongitudeRef, "W")?;
    if !lat.is_finite() || !lng.is_finite() || (lat == 0.0 && lng == 0.0) {
        return None;
    }
    let alt = exif.get_field(exif::Tag::GPSAltitude, exif::In::PRIMARY).and_then(|f| match &f.value {
        exif::Value::Rational(v) if !v.is_empty() => Some(v[0].to_f64()),
        _ => None,
    });
    let time = exif
        .get_field(exif::Tag::DateTimeOriginal, exif::In::PRIMARY)
        .map(|f| f.display_value().to_string());
    Some(json!({
        "path": path.to_string_lossy(),
        "name": path.file_name().map(|n| n.to_string_lossy()),
        "lng": lng, "lat": lat, "alt": alt, "time": time,
    }))
}

/// Every JPEG in the folder (and up to 3 levels of sub-folders, e.g. DCIM\100MEDIA) with its GPS position.
#[tauri::command]
pub async fn photos_scan(folder: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = PathBuf::from(&folder);
        if !dir.is_dir() {
            return json!({ "ok": false, "error": "That folder doesn't exist." });
        }
        let mut files = Vec::new();
        collect_photos(&dir, 3, &mut files);
        let mut photos = Vec::new();
        let mut no_gps = Vec::new();
        for f in &files {
            match read_photo(f) {
                Some(p) => photos.push(p),
                None => no_gps.push(f.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()),
            }
        }
        json!({ "ok": true, "folder": folder, "photos": photos, "noGps": no_gps })
    })
    .await
    .map_err(|e| e.to_string())
}

/* ---------------------------------------------------------------- hardware ---------- */

/// Graphics cards (with their real video memory: WMI caps it at 4 GB, the driver registry
/// doesn't), memory and processor threads, for the "how well will this PC cope" guide.
const HARDWARE_PS: &str = r#"
$ErrorActionPreference = 'SilentlyContinue'
$gpus = @(Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}\0*' |
  Where-Object { $_.DriverDesc } | ForEach-Object {
    $m = $_.'HardwareInformation.qwMemorySize'
    if (-not $m) { $m = $_.'HardwareInformation.MemorySize'; if ($m -is [byte[]]) { $m = [BitConverter]::ToUInt32($m, 0) } }
    @{ name = [string]$_.DriverDesc; vramGb = [math]::Round([double]$m / 1GB, 2) }
  })
$ram = (Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory
@{ ramGb = [math]::Round([double]$ram / 1GB, 1); gpus = $gpus } | ConvertTo-Json -Compress -Depth 3
"#;

#[tauri::command]
pub async fn hardware_info() -> Result<Value, String> {
    static CACHE: std::sync::OnceLock<Value> = std::sync::OnceLock::new();
    if let Some(v) = CACHE.get() {
        return Ok(v.clone());
    }
    let v = tauri::async_runtime::spawn_blocking(|| {
        let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1);
        let mut cmd = Command::new("powershell.exe");
        cmd.args(["-NoProfile", "-NonInteractive", "-Command", HARDWARE_PS]);
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);
        let parsed: Option<Value> = cmd.output().ok().and_then(|o| serde_json::from_slice(&o.stdout).ok());
        let mut v = parsed.unwrap_or_else(|| json!({ "ramGb": 0, "gpus": [] }));
        // ConvertTo-Json turns a one-item array into an object.
        if v["gpus"].is_object() {
            v["gpus"] = json!([v["gpus"].clone()]);
        }
        v["cores"] = json!(cores);
        v["ok"] = json!(true);
        v
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(CACHE.get_or_init(|| v).clone())
}

/* ---------------------------------------------------------------- running ---------- */

/// Run a tool, logging every line to log.txt and handing it to `on_line`. Stops (and kills the
/// whole process tree) when `cancel` is set.
fn run_logged(mut cmd: Command, log: &mut File, running: &Running, mut on_line: impl FnMut(&str)) -> Result<(), String> {
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).stdin(Stdio::null());
    // ODM's run.bat finds its helper scripts in the current folder; this would stop that.
    cmd.env_remove("NoDefaultCurrentDirectoryInExePath");
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let _ = writeln!(log, "\n> {:?}\n", cmd);
    let mut child: Child = cmd.spawn().map_err(|e| format!("Couldn't start the tool: {e}. If Windows blocked it, allow it and try again."))?;
    *running.pid.lock().unwrap() = Some(child.id());
    let (tx, rx) = mpsc::channel::<String>();
    for stream in [child.stdout.take().map(|s| Box::new(s) as Box<dyn std::io::Read + Send>), child.stderr.take().map(|s| Box::new(s) as Box<dyn std::io::Read + Send>)]
        .into_iter()
        .flatten()
    {
        let tx = tx.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stream).split(b'\n').map_while(Result::ok) {
                let line = String::from_utf8_lossy(&line).trim_end().to_string();
                if tx.send(line).is_err() {
                    break;
                }
            }
        });
    }
    drop(tx);
    loop {
        if running.cancel.load(Ordering::SeqCst) {
            kill_tree(child.id());
            let _ = child.wait();
            *running.pid.lock().unwrap() = None;
            return Err("Cancelled.".into());
        }
        match rx.recv_timeout(Duration::from_millis(300)) {
            Ok(line) => {
                let _ = writeln!(log, "{line}");
                on_line(&line);
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    *running.pid.lock().unwrap() = None;
    if status.success() { Ok(()) } else { Err(format!("The tool stopped with code {}. See log.txt in the result folder.", status.code().unwrap_or(-1))) }
}

fn kill_tree(pid: u32) {
    let mut cmd = Command::new("taskkill");
    cmd.args(["/T", "/F", "/PID", &pid.to_string()]).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let _ = cmd.status();
}

/// Stop whatever is running; called when the app exits so engines don't run on unseen.
pub fn stop_all(app: &AppHandle) {
    let state = app.state::<JobState>();
    if let Some(r) = state.running.lock().unwrap().as_ref() {
        r.cancel.store(true, Ordering::SeqCst);
        if let Some(pid) = *r.pid.lock().unwrap() {
            kill_tree(pid);
        }
    }
}

/// ODM stages in order, with a rough share of the total time each takes.
const ODM_STAGES: &[(&str, f64, &str)] = &[
    ("dataset", 2.0, "Reading photos"),
    ("split", 1.0, "Reading photos"),
    ("merge", 1.0, "Reading photos"),
    ("opensfm", 30.0, "Matching photos"),
    ("openmvs", 22.0, "Building the point cloud"),
    ("odm_filterpoints", 3.0, "Cleaning the point cloud"),
    ("odm_meshing", 8.0, "Building the 3D mesh"),
    ("mvs_texturing", 10.0, "Texturing the 3D model"),
    ("odm_georeferencing", 4.0, "Georeferencing"),
    ("odm_dem", 4.0, "Elevation model"),
    ("odm_orthophoto", 10.0, "Making the map"),
    ("odm_report", 3.0, "Report"),
    ("odm_postprocess", 2.0, "Finishing"),
];

fn odm_stage(line: &str) -> Option<(f64, &'static str)> {
    let name = line.split("Running ").nth(1)?.strip_suffix(" stage")?.trim();
    let total: f64 = ODM_STAGES.iter().map(|s| s.1).sum();
    let mut before = 0.0;
    for (stage, weight, label) in ODM_STAGES {
        if *stage == name {
            return Some((before / total, label));
        }
        before += weight;
    }
    None
}

/// "[12/41]"-style counters in COLMAP's log.
fn fraction(line: &str) -> Option<f64> {
    let inner = line.rsplit('[').next()?.split(']').next()?;
    let (a, b) = inner.split_once('/')?;
    let (a, b): (f64, f64) = (a.trim().parse().ok()?, b.trim().parse().ok()?);
    (b > 0.0).then(|| (a / b).clamp(0.0, 1.0))
}

struct Preset {
    odm: &'static [&'static str],
    colmap_quality: &'static str,
    brush_steps: u32,
    brush_resolution: u32,
}

fn preset(quality: &str) -> Preset {
    match quality {
        "fast" => Preset { odm: &["--pc-quality", "low", "--feature-quality", "medium"], colmap_quality: "low", brush_steps: 5000, brush_resolution: 1024 },
        "high" => Preset { odm: &["--pc-quality", "high", "--feature-quality", "ultra"], colmap_quality: "high", brush_steps: 30000, brush_resolution: 1920 },
        _ => Preset { odm: &[], colmap_quality: "medium", brush_steps: 15000, brush_resolution: 1600 },
    }
}

#[tauri::command]
pub fn job_start(app: AppHandle, state: State<'_, JobState>, kind: String, name: String, photos: Vec<String>, quality: String) -> Value {
    let fail = |e: &str| json!({ "ok": false, "error": e });
    let pack = match kind.as_str() {
        "map" => "photogrammetry",
        "splat" => "splats",
        _ => return fail("Unknown kind of result."),
    };
    let Some(pack_dir) = crate::engines::installed_pack(&app, pack) else {
        return fail("Install the processing tools for this first (Processing tools, below).");
    };
    if photos.len() < 5 {
        return fail("Choose a folder with at least 5 photos.");
    }
    let mut slot = state.running.lock().unwrap();
    if slot.is_some() {
        return fail("Another job is running. Wait for it to finish or cancel it first.");
    }
    let root = match root(&app) {
        Ok(r) => r,
        Err(e) => return fail(&e),
    };
    let stamp = chrono_stamp();
    let id = format!("{stamp}-{}-{}", slug(&name), kind);
    let dir = root.join(&id);
    if let Err(e) = fs::create_dir_all(dir.join("images")) {
        return fail(&format!("Couldn't create {}: {e}", dir.display()));
    }
    let job = json!({
        "id": id, "name": name, "kind": kind, "quality": quality, "photos": photos.len(),
        "status": "running", "stage": "Starting", "startedAt": unix_now(),
    });
    write_job(&dir, &job);
    let running = Running { id: id.clone(), name: name.clone(), kind: kind.clone(), cancel: Arc::default(), pid: Arc::default() };
    *slot = Some(running.clone());
    drop(slot);

    let state = state.inner().clone();
    let result = json!({ "ok": true, "id": id, "dir": dir.to_string_lossy() });
    std::thread::spawn(move || {
        let started = Instant::now();
        let mut job = job;
        let result = run_job(&app, &running, &dir, &pack_dir, &kind, &photos, &quality, &mut job);
        job["finishedAt"] = json!(unix_now());
        job["seconds"] = json!(started.elapsed().as_secs());
        let (status, message) = match &result {
            Ok(()) => ("done", "Finished".to_string()),
            Err(e) if running.cancel.load(Ordering::SeqCst) => ("cancelled", e.clone()),
            Err(e) => ("failed", e.clone()),
        };
        job["status"] = json!(status);
        if let Err(e) = &result {
            job["error"] = json!(e);
        }
        write_job(&dir, &job);
        *state.running.lock().unwrap() = None;
        let _ = app.emit("job-progress", Progress { id: running.id.clone(), name: running.name.clone(), kind: running.kind.clone(), stage: status.into(), pct: 100.0, line: message });
    });
    result
}

#[allow(clippy::too_many_arguments)]
fn run_job(app: &AppHandle, running: &Running, dir: &Path, pack: &Path, kind: &str, photos: &[String], quality: &str, job: &mut Value) -> Result<(), String> {
    let mut log = File::create(dir.join("log.txt")).map_err(|e| e.to_string())?;
    let emit = |stage: &str, pct: f64, line: &str| {
        let _ = app.emit("job-progress", Progress { id: running.id.clone(), name: running.name.clone(), kind: running.kind.clone(), stage: stage.into(), pct: (pct * 100.0).clamp(0.0, 100.0), line: line.into() });
    };
    let mut last_save = Instant::now();
    let mut save_stage = |job: &mut Value, stage: &str| {
        if job["stage"] != stage || last_save.elapsed() > Duration::from_secs(5) {
            job["stage"] = json!(stage);
            write_job(dir, job);
            last_save = Instant::now();
        }
    };

    // 1. Copy the photos in: the engines want one folder of images, and the originals stay untouched.
    let images = dir.join("images");
    // Where the photos were taken, padded: the map's extent, for the map overlay.
    let mut bounds: Option<[f64; 4]> = None;
    for (i, src) in photos.iter().enumerate() {
        if running.cancel.load(Ordering::SeqCst) {
            return Err("Cancelled.".into());
        }
        let src = Path::new(src);
        let name = src.file_name().ok_or("Bad photo path")?;
        let mut dest = images.join(name);
        if dest.exists() {
            dest = images.join(format!("{i:05}-{}", name.to_string_lossy()));
        }
        fs::copy(src, &dest).map_err(|e| format!("Couldn't copy {}: {e}", src.display()))?;
        if let Some(p) = read_photo(&dest) {
            let (x, y) = (p["lng"].as_f64().unwrap_or(0.0), p["lat"].as_f64().unwrap_or(0.0));
            bounds = Some(match bounds {
                None => [x, y, x, y],
                Some([w, s, e, n]) => [w.min(x), s.min(y), e.max(x), n.max(y)],
            });
        }
        emit("Copying photos", 0.03 * (i + 1) as f64 / photos.len() as f64, &format!("{} of {}", i + 1, photos.len()));
    }
    if let Some([w, s, e, n]) = bounds {
        let pad_lat = 60.0 / 111_320.0;
        let pad_lng = pad_lat / s.to_radians().cos().abs().max(0.1);
        job["bounds"] = json!([w - pad_lng, s - pad_lat, e + pad_lng, n + pad_lat]);
    }
    save_stage(job, "Copying photos");
    let p = preset(quality);

    if kind == "map" {
        let odm = pack.join("odm");
        let parent = dir.parent().ok_or("Bad job folder")?;
        let mut cmd = Command::new(odm.join("run.bat"));
        cmd.current_dir(&odm)
            .arg("--project-path")
            .arg(parent)
            .arg(dir.file_name().ok_or("Bad job folder")?)
            .args(["--tiles", "--gltf", "--skip-report"])
            .args(p.odm);
        let mut stage = "Starting";
        let mut at = 0.03;
        run_logged(cmd, &mut log, running, |line| {
            if let Some((frac, label)) = odm_stage(line) {
                stage = label;
                at = 0.03 + 0.97 * frac;
                save_stage(job, stage);
            }
            emit(stage, at, line);
        })?;
        let ortho = dir.join("odm_orthophoto").join("odm_orthophoto.tif");
        if !ortho.is_file() {
            return Err("OpenDroneMap finished but made no map. The photos may not overlap enough; see log.txt.".into());
        }
        job["outputs"] = json!({
            "orthophoto": ortho.to_string_lossy(),
            "tiles": tiles_dir(dir),
            // Prefer the single-file GLB (--gltf): far quicker to open than OBJ + dozens of PNGs.
            "model": first_existing(&[
                dir.join("odm_texturing").join("odm_textured_model_geo.glb"),
                dir.join("odm_texturing").join("odm_textured_model_geo.obj"),
                dir.join("odm_texturing").join("odm_textured_model.obj"),
            ]),
            "pointCloud": first_existing(&[dir.join("odm_georeferencing").join("odm_georeferenced_model.laz")]),
            "dem": first_existing(&[dir.join("odm_dem").join("dsm.tif")]),
        });
        return Ok(());
    }

    // Splat: COLMAP works out where each photo was taken, then Brush trains the splat.
    let colmap = pack.join("colmap").join("bin").join("colmap.exe");
    let mut cmd = Command::new(&colmap);
    cmd.current_dir(colmap.parent().unwrap())
        .arg("automatic_reconstructor")
        .arg("--workspace_path")
        .arg(dir)
        .arg("--image_path")
        .arg(&images)
        .args(["--sparse", "1", "--dense", "0", "--use_gpu", "0", "--single_camera", "1", "--log_target", "stderr", "--log_color", "0"])
        .args(["--quality", p.colmap_quality]);
    let mut stage = "Finding features";
    let mut at: f64 = 0.03;
    run_logged(cmd, &mut log, running, |line| {
        let (label, from, to) = if line.contains("Feature extraction") || line.contains("Processed file") {
            ("Finding features", 0.03, 0.15)
        } else if line.contains("matching") || line.contains("Matching") {
            ("Matching photos", 0.15, 0.32)
        } else if line.contains("Registering image") || line.contains("mapping") || line.contains("Mapper") {
            ("Placing cameras", 0.32, 0.45)
        } else {
            (stage, at, at)
        };
        if label != stage {
            stage = label;
            at = from;
            save_stage(job, stage);
        }
        if let Some(f) = fraction(line) {
            at = at.max(from + (to - from) * f);
        }
        emit(stage, at, line);
    })?;
    if !dir.join("sparse").join("0").join("images.bin").is_file() {
        return Err("COLMAP couldn't work out where the photos were taken. They may not overlap enough; see log.txt.".into());
    }

    let brush = pack.join("brush").join("brush_app.exe");
    let out = dir.join("splat");
    fs::create_dir_all(&out).map_err(|e| e.to_string())?;
    let steps = p.brush_steps.to_string();
    let mut cmd = Command::new(&brush);
    cmd.current_dir(&out)
        .arg(dir)
        .args(["--total-steps", &steps, "--export-every", &steps, "--max-resolution", &p.brush_resolution.to_string()])
        .arg("--export-path")
        .arg(&out)
        .args(["--export-name", "splat.ply"]);
    let total = p.brush_steps as f64;
    let mut at = 0.45;
    save_stage(job, "Training the splat");
    run_logged(cmd, &mut log, running, |line| {
        if let Some(step) = brush_step(line) {
            at = 0.45 + 0.55 * (step / total).clamp(0.0, 1.0);
        }
        emit("Training the splat", at, line);
    })?;
    let ply = first_existing(&[out.join("splat.ply")]).or_else(|| newest_ply(&out));
    let Some(ply) = ply else {
        return Err("Brush finished but saved no splat; see log.txt.".into());
    };
    job["outputs"] = json!({ "splat": ply });
    Ok(())
}

fn brush_step(line: &str) -> Option<f64> {
    let lower = line.to_ascii_lowercase();
    let i = lower.find("step")?;
    let digits: String = lower[i + 4..].chars().skip_while(|c| !c.is_ascii_digit()).take_while(|c| c.is_ascii_digit()).collect();
    digits.parse().ok()
}

/// ODM's `--tiles` output: TMS tiles of the orthophoto, at `<job>\orthophoto_tiles`.
fn tiles_dir(dir: &Path) -> Option<String> {
    let t = dir.join("orthophoto_tiles");
    t.is_dir().then(|| t.to_string_lossy().to_string())
}

fn first_existing(paths: &[PathBuf]) -> Option<String> {
    paths.iter().find(|p| p.is_file()).map(|p| p.to_string_lossy().to_string())
}

fn newest_ply(dir: &Path) -> Option<String> {
    fs::read_dir(dir)
        .ok()?
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "ply"))
        .max_by_key(|e| e.metadata().and_then(|m| m.modified()).ok())
        .map(|e| e.path().to_string_lossy().to_string())
}

fn chrono_stamp() -> String {
    // Local time without a date crate: ask Windows via the file time of a fresh temp file
    // would be overkill; UTC seconds keep ids unique and sortable.
    let s = unix_now();
    let (days, rem) = (s / 86_400, s % 86_400);
    let (y, m, d) = civil_from_days(days as i64);
    format!("{y:04}{m:02}{d:02}-{:02}{:02}{:02}", rem / 3600, rem % 3600 / 60, rem % 60)
}

/// Days since 1970-01-01 → (year, month, day). Howard Hinnant's algorithm.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[tauri::command]
pub fn job_cancel(state: State<'_, JobState>, id: String) -> Value {
    match state.running.lock().unwrap().as_ref() {
        Some(r) if r.id == id => {
            r.cancel.store(true, Ordering::SeqCst);
            json!({ "ok": true })
        }
        _ => json!({ "ok": false, "error": "That job isn't running." }),
    }
}

#[tauri::command]
pub fn jobs_list(app: AppHandle, state: State<'_, JobState>) -> Value {
    let Ok(root) = root(&app) else { return json!({ "ok": true, "jobs": [] }) };
    let running = state.running.lock().unwrap().as_ref().map(|r| r.id.clone());
    let mut jobs: Vec<Value> = fs::read_dir(&root)
        .map(|it| it.flatten().filter_map(|e| read_job(&e.path()).map(|j| (e.path(), j))).collect::<Vec<_>>())
        .unwrap_or_default()
        .into_iter()
        .map(|(path, mut j)| {
            // A job left "running" by an app that closed mid-way.
            if j["status"] == "running" && running.as_deref() != j["id"].as_str() {
                j["status"] = json!("interrupted");
            }
            if j["kind"] == "map" && j["status"] == "done" && j["outputs"]["tiles"].is_null() {
                j["outputs"]["tiles"] = json!(tiles_dir(&path));
            }
            j["dir"] = json!(path.to_string_lossy());
            j
        })
        .collect();
    jobs.sort_by(|a, b| b["startedAt"].as_u64().cmp(&a["startedAt"].as_u64()));
    json!({ "ok": true, "root": root.to_string_lossy(), "jobs": jobs, "running": running })
}

/// Show a result: the folder in Explorer, the 3D model selected in Explorer, or the splat in Brush.
#[tauri::command]
pub fn job_open(app: AppHandle, id: String, what: String) -> Value {
    let dir = match job_dir(&app, &id) {
        Ok(d) => d,
        Err(e) => return json!({ "ok": false, "error": e }),
    };
    let job = read_job(&dir).unwrap_or_default();
    let output = |key: &str| job["outputs"][key].as_str().map(PathBuf::from).filter(|p| p.starts_with(&dir) && p.is_file());
    let mut cmd = match what.as_str() {
        "folder" => {
            let mut c = Command::new("explorer.exe");
            c.arg(&dir);
            c
        }
        "model" | "orthophoto" => match output(what.as_str()) {
            Some(p) => {
                let mut c = Command::new("explorer.exe");
                c.raw_arg(format!("/select,\"{}\"", p.display()));
                c
            }
            None => return json!({ "ok": false, "error": "That file isn't there any more." }),
        },
        "splat" => match (output("splat"), crate::engines::installed_pack(&app, "splats")) {
            (Some(p), Some(pack)) => {
                let mut c = Command::new(pack.join("brush").join("brush_app.exe"));
                c.arg(p);
                c
            }
            _ => return json!({ "ok": false, "error": "The splat or the splat tools are missing." }),
        },
        _ => return json!({ "ok": false, "error": "Unknown output." }),
    };
    cmd.env_remove("NoDefaultCurrentDirectoryInExePath");
    match cmd.spawn() {
        Ok(_) => json!({ "ok": true }),
        Err(e) => json!({ "ok": false, "error": format!("Couldn't open it: {e}") }),
    }
}

#[tauri::command]
pub fn job_delete(app: AppHandle, state: State<'_, JobState>, id: String) -> Value {
    if state.running.lock().unwrap().as_ref().is_some_and(|r| r.id == id) {
        return json!({ "ok": false, "error": "Cancel the job before deleting it." });
    }
    match job_dir(&app, &id).and_then(|d| fs::remove_dir_all(&d).map_err(|e| format!("Couldn't delete it: {e}"))) {
        Ok(()) => json!({ "ok": true }),
        Err(e) => json!({ "ok": false, "error": e }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn job_ids_are_plain_names() {
        assert!(is_job_id("20261006-101500-site-a-map"));
        assert!(!is_job_id("../etc"));
        assert!(!is_job_id("a\\b"));
        assert!(!is_job_id(""));
    }

    #[test]
    fn slugs() {
        assert_eq!(slug("Water tower orbit!"), "Water-tower-orbit");
        assert_eq!(slug("  "), "photos");
        assert_eq!(slug("Ünïcode"), "n-code");
    }

    #[test]
    fn odm_stages_parse() {
        assert_eq!(odm_stage("[INFO]    Running dataset stage").map(|s| s.0), Some(0.0));
        let (f, label) = odm_stage("[INFO]    Running odm_orthophoto stage").unwrap();
        assert!(f > 0.7 && f < 0.95, "{f}");
        assert_eq!(label, "Making the map");
        assert!(odm_stage("[INFO]    running \"x\" match_features").is_none());
    }

    #[test]
    fn counters() {
        assert_eq!(fraction("Processed file [12/48]"), Some(0.25));
        assert_eq!(fraction("no counter"), None);
        assert_eq!(brush_step("Training step 1500/5000"), Some(1500.0));
    }

    #[test]
    fn dates() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(20_367), (2025, 10, 6));
    }
}
