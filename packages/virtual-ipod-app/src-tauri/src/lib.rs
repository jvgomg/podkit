mod commands;
mod vm;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            commands::vm_status,
            commands::vm_start,
            commands::vm_stop,
            commands::server_health,
        ])
        .run(tauri::generate_context!())
        .expect("error running tauri application");
}
