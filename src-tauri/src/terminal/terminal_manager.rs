use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct TerminalOpenResult {
    pub terminalId: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TerminalDataEvent {
    pub terminalId: String,
    pub data: Vec<u8>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TerminalExitEvent {
    pub terminalId: String,
    pub exitCode: Option<i32>,
}
