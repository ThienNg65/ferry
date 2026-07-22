use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tokio::fs;

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ProxyInfo {
    pub r#type: String,
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub hasPassword: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct AppSettings {
    #[serde(default)]
    pub openTabSiteIds: Vec<String>,
    #[serde(default)]
    pub bandwidthLimitKBps: Option<u64>,
    #[serde(default)]
    pub defaultProxy: Option<ProxyInfo>,
}

pub struct SettingsStore {
    pub config_path: PathBuf,
}

impl SettingsStore {
    pub fn new(config_dir: PathBuf) -> Self {
        Self {
            config_path: config_dir.join("app-settings.json"),
        }
    }

    pub async fn load(&self) -> AppSettings {
        if !self.config_path.exists() {
            return AppSettings::default();
        }
        match fs::read_to_string(&self.config_path).await {
            Ok(data) => serde_json::from_str(&data).unwrap_or_default(),
            Err(_) => AppSettings::default(),
        }
    }

    pub async fn save(&self, settings: &AppSettings) -> Result<(), String> {
        if let Some(parent) = self.config_path.parent() {
            let _ = fs::create_dir_all(parent).await;
        }
        let content = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
        fs::write(&self.config_path, content).await.map_err(|e| e.to_string())
    }
}
