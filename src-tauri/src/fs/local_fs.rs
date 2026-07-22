use serde::{Deserialize, Serialize};
use std::path::Path;
use tokio::fs;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub isDir: bool,
    pub size: u64,
    pub modifiedAt: Option<String>,
    pub permissions: Option<String>,
    pub isSymlink: bool,
    pub symlinkTarget: Option<String>,
    pub symlinkBroken: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileListResult {
    pub path: String,
    pub entries: Vec<FileEntry>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileReadResult {
    pub path: String,
    pub content: String,
    pub truncated: bool,
    pub size: u64,
}

pub async fn list_local_directory(dir_path: &str) -> Result<FileListResult, String> {
    let target_path = if dir_path.is_empty() {
        std::env::current_dir().map_err(|e| e.to_string())?
    } else {
        Path::new(dir_path).to_path_buf()
    };

    let canonical_path = fs::canonicalize(&target_path)
        .await
        .unwrap_or_else(|_| target_path.clone());
    let canonical_str = canonical_path.to_string_lossy().to_string();

    let mut dir = fs::read_dir(&canonical_path).await.map_err(|e| e.to_string())?;
    let mut entries = Vec::new();

    while let Ok(Some(entry)) = dir.next_entry().await {
        let metadata = entry.metadata().await;
        let file_type = entry.file_type().await;
        let is_symlink = file_type.as_ref().map(|ft| ft.is_symlink()).unwrap_or(false);

        let (is_dir, size, modified_at) = match metadata {
            Ok(meta) => {
                let is_d = meta.is_dir();
                let sz = meta.len();
                let mtime = meta.modified().ok().map(|t| {
                    let datetime: chrono::DateTime<chrono::Utc> = t.into();
                    datetime.to_rfc3339()
                });
                (is_d, sz, mtime)
            }
            Err(_) => (false, 0, None),
        };

        let file_name = entry.file_name().to_string_lossy().to_string();
        let entry_path = entry.path().to_string_lossy().to_string();

        entries.push(FileEntry {
            name: file_name,
            path: entry_path,
            isDir: is_dir,
            size,
            modifiedAt: modified_at,
            permissions: None,
            isSymlink: is_symlink,
            symlinkTarget: None,
            symlinkBroken: if is_symlink { Some(false) } else { None },
        });
    }

    Ok(FileListResult {
        path: canonical_str,
        entries,
    })
}

pub async fn read_local_file(file_path: &str, max_bytes: usize) -> Result<FileReadResult, String> {
    let meta = fs::metadata(file_path).await.map_err(|e| e.to_string())?;
    let total_size = meta.len();
    let cap = max_bytes.min(1024 * 1024); // max 1MB preview

    let bytes = fs::read(file_path).await.map_err(|e| e.to_string())?;
    let truncated = bytes.length() > cap;
    let slice = if truncated { &bytes[..cap] } else { &bytes[..] };
    let content = String::from_utf8_lossy(slice).to_string();

    Ok(FileReadResult {
        path: file_path.to_string(),
        content,
        truncated,
        size: total_size,
    })
}
