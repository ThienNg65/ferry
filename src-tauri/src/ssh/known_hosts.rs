use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use tokio::fs;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HostKeyRecord {
    pub host: String,
    pub port: u16,
    pub key_type: String,
    pub public_key_base64: String,
}

#[derive(Debug, Default)]
pub struct KnownHostsStore {
    pub file_path: PathBuf,
    pub records: HashMap<String, HostKeyRecord>,
}

impl KnownHostsStore {
    pub fn new(file_path: PathBuf) -> Self {
        Self {
            file_path,
            records: HashMap::new(),
        }
    }

    pub async fn load(&mut self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        if !self.file_path.exists() {
            return Ok(());
        }
        let content = fs::read_to_string(&self.file_path).await?;
        let items: Vec<HostKeyRecord> = serde_json::from_str(&content)?;
        for item in items {
            let key = format!("{}:{}", item.host, item.port);
            self.records.insert(key, item);
        }
        Ok(())
    }

    pub async fn save(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        if let Some(parent) = self.file_path.parent() {
            fs::create_dir_all(parent).await?;
        }
        let items: Vec<&HostKeyRecord> = self.records.values().collect();
        let content = serde_json::to_string_pretty(&items)?;
        fs::write(&self.file_path, content).await?;
        Ok(())
    }

    pub fn get(&self, host: &str, port: u16) -> Option<&HostKeyRecord> {
        let key = format!("{}:{}", host, port);
        self.records.get(&key)
    }

    pub async fn set(&mut self, record: HostKeyRecord) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let key = format!("{}:{}", record.host, record.port);
        self.records.insert(key, record);
        self.save().await
    }
}
