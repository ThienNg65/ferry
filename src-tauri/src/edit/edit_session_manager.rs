use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EditEvent {
    pub editId: String,
    pub sessionId: Option<String>,
    pub remotePath: Option<String>,
    pub localTempPath: String,
    pub state: String, // "opened" | "reuploading" | "reuploaded" | "upload-error" | "session-closed" | "closed"
    pub error: Option<String>,
}
