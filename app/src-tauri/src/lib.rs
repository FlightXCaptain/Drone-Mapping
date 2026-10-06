mod controller;
mod engines;
mod jobs;
mod sources;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .manage(controller::ControllerLock::default())
    .manage(engines::EngineState::default())
    .manage(jobs::JobState::default())
    .invoke_handler(tauri::generate_handler![
      controller::rc_list,
      controller::rc_fetch,
      controller::rc_send,
      engines::engine_status,
      engines::engine_install,
      engines::engine_cancel,
      engines::engine_remove,
      jobs::photos_scan,
      sources::photo_sources,
      sources::photos_import,
      jobs::hardware_info,
      jobs::job_start,
      jobs::job_cancel,
      jobs::jobs_list,
      jobs::job_open,
      jobs::job_delete,
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app, event| {
      // Don't leave a photogrammetry engine running unseen after the window closes.
      if let tauri::RunEvent::Exit = event {
        jobs::stop_all(app);
      }
    });
}
