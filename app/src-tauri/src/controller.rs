//! Talk to a DJI controller plugged in by USB, via the bundled send-to-dji-fly.ps1 helper.
//!
//! These are Tauri commands, callable only from the app's own window, so unlike the dev-server
//! bridge there's no HTTP endpoint for other pages or devices to reach. All safety rules (one
//! file only, validation, verified backup, restore on failure) live in the helper script.

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{path::BaseDirectory, AppHandle, Manager, State};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// The controller can only do one thing at a time; commands queue on this lock.
#[derive(Default, Clone)]
pub struct ControllerLock(Arc<Mutex<()>>);

fn fail(msg: impl Into<String>) -> Value {
    json!({ "ok": false, "error": msg.into() })
}

fn is_mission_id(s: &str) -> bool {
    s.len() == 36
        && s.char_indices().all(|(i, c)| match i {
            8 | 13 | 18 | 23 => c == '-',
            _ => c.is_ascii_hexdigit(),
        })
}

fn script_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .resolve("tools/send-to-dji-fly.ps1", BaseDirectory::Resource)
        .map_err(|e| format!("Controller helper not found: {e}"))
}

fn temp_file(name: &str) -> PathBuf {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    std::env::temp_dir().join(format!("drone-mapping-{}-{nanos}-{name}", std::process::id()))
}

/// Run the helper with -Json and return its ##RESULT object.
fn run_script(app: &AppHandle, args: &[&str]) -> Value {
    if !cfg!(windows) {
        return fail("Sending to a controller needs Windows.");
    }
    let script = match script_path(app) {
        Ok(p) => p,
        Err(e) => return fail(e),
    };
    let mut cmd = Command::new("powershell.exe");
    cmd.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"])
        .arg(&script)
        .arg("-Json")
        .args(args);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let output = match cmd.output() {
        Ok(o) => o,
        Err(e) => return fail(format!("Couldn't start the controller helper: {e}")),
    };
    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .lines()
        .find_map(|l| l.strip_prefix("##RESULT "))
        .and_then(|j| serde_json::from_str(j).ok())
        .unwrap_or_else(|| {
            // No result line: the helper couldn't run (e.g. a script policy). Show why.
            let stderr = String::from_utf8_lossy(&output.stderr);
            let detail: String = stderr.lines().map(str::trim).filter(|l| !l.is_empty()).take(3).collect::<Vec<_>>().join(" ");
            fail(if detail.is_empty() {
                "No response from the controller helper.".to_string()
            } else {
                format!("The controller helper couldn't run: {detail}")
            })
        })
}

async fn locked<F>(lock: &ControllerLock, work: F) -> Value
where
    F: FnOnce() -> Value + Send + 'static,
{
    let lock = lock.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock.0.lock().unwrap_or_else(|p| p.into_inner());
        work()
    })
    .await
    .unwrap_or_else(|e| fail(format!("Controller task failed: {e}")))
}

/// Controller name and the DJI Fly missions on it.
#[tauri::command]
pub async fn rc_list(app: AppHandle, lock: State<'_, ControllerLock>) -> Result<Value, ()> {
    Ok(locked(&lock, move || run_script(&app, &["-List"])).await)
}

/// Read-only copy of one mission's KMZ, base64-encoded.
#[tauri::command]
pub async fn rc_fetch(app: AppHandle, lock: State<'_, ControllerLock>, mission: String) -> Result<Value, ()> {
    if !is_mission_id(&mission) {
        return Ok(fail("That isn't a DJI Fly mission id."));
    }
    Ok(locked(&lock, move || {
        let out = temp_file("fetched.kmz");
        let out_str = out.to_string_lossy().to_string();
        let r = run_script(&app, &["-Fetch", "-Mission", &mission, "-Out", &out_str]);
        if r["ok"] != json!(true) {
            return r;
        }
        let result = match std::fs::read(&out) {
            Ok(bytes) => json!({ "ok": true, "mission": mission, "kmzBase64": B64.encode(bytes) }),
            Err(e) => fail(format!("Couldn't read the copied mission: {e}")),
        };
        let _ = std::fs::remove_file(&out);
        result
    })
    .await)
}

/// Replace a placeholder mission's KMZ (backup, validate, verify and restore are in the helper).
#[tauri::command]
pub async fn rc_send(
    app: AppHandle,
    lock: State<'_, ControllerLock>,
    kmz_base64: String,
    mission: String,
    what_if: Option<bool>,
) -> Result<Value, ()> {
    if !is_mission_id(&mission) {
        return Ok(fail("Choose a placeholder mission."));
    }
    let bytes = match B64.decode(kmz_base64.as_bytes()) {
        Ok(b) if !b.is_empty() && b.len() <= 10 * 1024 * 1024 => b,
        _ => return Ok(fail("The mission file is empty or too large.")),
    };
    Ok(locked(&lock, move || {
        let file = temp_file("mission.kmz");
        if let Err(e) = std::fs::write(&file, &bytes) {
            return fail(format!("Couldn't stage the mission: {e}"));
        }
        let file_str = file.to_string_lossy().to_string();
        let mut args = vec!["-Kmz", file_str.as_str(), "-Mission", mission.as_str()];
        if what_if.unwrap_or(false) {
            args.push("-WhatIf");
        }
        let r = run_script(&app, &args);
        let _ = std::fs::remove_file(&file);
        r
    })
    .await)
}

#[cfg(test)]
mod tests {
    use super::is_mission_id;

    #[test]
    fn mission_ids() {
        assert!(is_mission_id("BACAD3AC-ECEC-470A-B69B-5145AB8FC239"));
        assert!(!is_mission_id("..\\..\\..\\DCIM"));
        assert!(!is_mission_id("BACAD3AC-ECEC-470A-B69B-5145AB8FC23"));
        assert!(!is_mission_id("BACAD3ACxECEC-470A-B69B-5145AB8FC239"));
    }
}
