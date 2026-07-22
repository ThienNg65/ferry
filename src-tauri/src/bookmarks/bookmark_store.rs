use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tokio::fs;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Bookmark {
    pub id: String,
    pub scope: String, // "local" | "remote"
    pub siteId: Option<String>,
    pub path: String,
    pub label: String,
    pub createdAt: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BookmarkInput {
    pub scope: String,
    pub siteId: Option<String>,
    pub path: String,
    pub label: String,
}

pub struct BookmarkStore {
    pub store_path: PathBuf,
}

impl BookmarkStore {
    pub fn new(config_dir: PathBuf) -> Self {
        Self {
            store_path: config_dir.join("bookmarks.json"),
        }
    }

    pub async fn load_all(&self) -> Vec<Bookmark> {
        if !self.store_path.exists() {
            return Vec::new();
        }
        match fs::read_to_string(&self.store_path).await {
            Ok(data) => serde_json::from_str(&data).unwrap_or_default(),
            Err(_) => Vec::new(),
        }
    }

    pub async fn save_all(&self, items: &[Bookmark]) -> Result<(), String> {
        if let Some(parent) = self.store_path.parent() {
            let _ = fs::create_dir_all(parent).await;
        }
        let content = serde_json::to_string_pretty(items).map_err(|e| e.to_string())?;
        fs::write(&self.store_path, content).await.map_err(|e| e.to_string())
    }
}
