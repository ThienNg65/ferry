use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct TailLineEvent {
    pub tailId: String,
    pub line: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TailNoticeEvent {
    pub tailId: String,
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TailEndEvent {
    pub tailId: String,
    pub error: Option<String>,
}
