mod controller;
mod engines;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(controller::ControllerLock::default())
    .manage(engines::EngineState::default())
    .invoke_handler(tauri::generate_handler![
      controller::rc_list,
      controller::rc_fetch,
      controller::rc_send,
      engines::engine_status,
      engines::engine_install,
      engines::engine_cancel,
      engines::engine_remove,
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
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
