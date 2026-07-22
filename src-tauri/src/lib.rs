pub mod app;
pub mod bookmarks;
pub mod edit;
pub mod fs;
pub mod history;
pub mod ipc;
pub mod monitor;
pub mod sites;
pub mod ssh;
pub mod tail;
pub mod terminal;
pub mod transfer;

use ipc::commands::*;
use tauri::Builder;

pub fn run() {
    Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            system_get_app_version,
            system_get_downloads_path,
            fs_local_list,
            fs_local_read_file,
            sites_import_scan,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
