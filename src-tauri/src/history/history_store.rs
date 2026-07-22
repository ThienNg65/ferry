use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tokio::fs;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HistoryEntry {
    pub id: String,
    pub kind: String, // "transfer" | "operation"
    pub label: String,
    pub direction: Option<String>,
    pub operationKind: Option<String>,
    pub sessionId: Option<String>,
    pub siteName: Option<String>,
    pub bytes: Option<u64>,
    pub startedAt: u64,
    pub finishedAt: u64,
    pub status: String,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HistoryQuery {
    pub search: Option<String>,
    pub status: Option<String>,
    pub limit: Option<usize>,
}

pub struct HistoryStore {
    pub file_path: PathBuf,
}

impl HistoryStore {
    pub fn new(config_dir: PathBuf) -> Self {
        Self {
            file_path: config_dir.join("history.json"),
        }
    }

    pub async fn load_all(&self) -> Vec<HistoryEntry> {
        if !self.file_path.exists() {
            return Vec::new();
        }
        match fs::read_to_string(&self.file_path).await {
            Ok(data) => serde_json::from_str(&data).unwrap_or_default(),
            Err(_) => Vec::new(),
        }
    }

    pub async fn append(&self, entry: HistoryEntry) -> Result<(), String> {
        let mut list = self.load_all().await;
        list.insert(0, entry);
        if list.len() > 2000 {
            list.truncate(2000);
        }
        if let Some(parent) = self.file_path.parent() {
            let _ = fs::create_dir_all(parent).await;
        }
        let content = serde_json::to_string(&list).map_err(|e| e.to_string())?;
        fs::write(&self.file_path, content).await.map_err(|e| e.to_string())
    }

    pub async fn clear(&self) -> Result<(), String> {
        if self.file_path.exists() {
            fs::remove_file(&self.file_path).await.map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}
