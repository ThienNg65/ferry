use super::local_fs::FileListResult;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct DeleteManyResult {
    pub deletedPaths: Vec<String>,
    pub failures: Vec<DeleteFailure>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DeleteFailure {
    pub path: String,
    pub error: String,
}

// Remote filesystem helpers interface with active SFTP sessions in session_manager
