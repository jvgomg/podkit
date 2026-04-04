mod commands;
mod vm;

use tauri::{LogicalSize, Manager};

/// iPod shell dimensions (must match packages/ipod-web/src/ui/Shell.css)
const IPOD_WIDTH: f64 = 380.0;
const IPOD_HEIGHT: f64 = 637.0;
/// Extra space around the iPod for the drop shadow to render without clipping
const SHADOW_PADDING: f64 = 48.0;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            commands::vm_status,
            commands::vm_start,
            commands::vm_stop,
            commands::server_health,
        ])
        .setup(|app| {
            let window = app.get_webview_window("main").expect("main window not found");
            window.set_size(LogicalSize::new(
                IPOD_WIDTH + SHADOW_PADDING * 2.0,
                IPOD_HEIGHT + SHADOW_PADDING * 2.0,
            ))?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error running tauri application");
}
