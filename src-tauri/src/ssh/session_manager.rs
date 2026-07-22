use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Debug, Clone)]
pub struct SshSessionConfig {
    pub session_id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
}

#[derive(Debug, Default)]
pub struct SessionManager {
    sessions: Arc<RwLock<HashMap<String, SshSessionConfig>>>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn register_session(&self, config: SshSessionConfig) {
        let mut map = self.sessions.write().await;
        map.insert(config.session_id.clone(), config);
    }

    pub async fn remove_session(&self, session_id: &str) -> Option<SshSessionConfig> {
        let mut map = self.sessions.write().await;
        map.remove(session_id)
    }

    pub async fn get_session(&self, session_id: &str) -> Option<SshSessionConfig> {
        let map = self.sessions.read().await;
        map.get(session_id).cloned()
    }
}
