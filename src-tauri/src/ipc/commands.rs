use super::IpcResult;
use crate::fs::local_fs::{list_local_directory, read_local_file, FileListResult, FileReadResult};
use crate::sites::importer::{scan_winscp_sessions, ImportedSite};
use serde::{Deserialize, Serialize};
use tauri::command;

#[derive(Debug, Serialize, Deserialize)]
pub struct AppVersionResult {
    pub version: String,
}

#[command]
pub async fn system_get_app_version() -> IpcResult<AppVersionResult> {
    IpcResult::ok(AppVersionResult {
        version: env!("CARGO_PKG_VERSION").to_string(),
    })
}

#[command]
pub async fn system_get_downloads_path() -> IpcResult<String> {
    let path = dirs::download_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| ".".to_string());
    IpcResult::ok(path)
}

#[command]
pub async fn fs_local_list(path: String) -> IpcResult<FileListResult> {
    match list_local_directory(&path).await {
        Ok(res) => IpcResult::ok(res),
        Err(e) => IpcResult::err("NOT_FOUND", e),
    }
}

#[command]
pub async fn fs_local_read_file(path: String, max_bytes: Option<usize>) -> IpcResult<FileReadResult> {
    match read_local_file(&path, max_bytes.unwrap_or(256 * 1024)).await {
        Ok(res) => IpcResult::ok(res),
        Err(e) => IpcResult::err("NOT_FOUND", e),
    }
}

#[command]
pub async fn sites_import_scan() -> IpcResult<Vec<ImportedSite>> {
    match scan_winscp_sessions() {
        Ok(sites) => IpcResult::ok(sites),
        Err(e) => IpcResult::err("UNKNOWN", e.to_string()),
    }
}
