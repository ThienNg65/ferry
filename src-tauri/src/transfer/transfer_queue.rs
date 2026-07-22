use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TransferEnqueueResult {
    pub transferId: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TransferEvent {
    pub transferId: String,
    pub kind: String, // "upload" | "download"
    pub state: String, // "queued" | "started" | "progress" | "done" | "error" | "cancelled"
    pub bytesTransferred: Option<u64>,
    pub totalBytes: Option<u64>,
    pub bytesPerSec: Option<u64>,
    pub etaMs: Option<u64>,
    pub error: Option<String>,
}
