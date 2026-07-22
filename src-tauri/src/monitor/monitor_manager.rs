use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MonitorCpuSample {
    pub aggregatePct: f64,
    pub perCorePct: Vec<f64>,
    pub coreCount: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MonitorMemorySample {
    pub totalBytes: u64,
    pub usedBytes: u64,
    pub availableBytes: u64,
    pub buffersBytes: u64,
    pub cachedBytes: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MonitorSwapSample {
    pub totalBytes: u64,
    pub usedBytes: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MonitorDiskSample {
    pub totalBytes: u64,
    pub usedBytes: u64,
    pub availableBytes: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MonitorProcessSample {
    pub pid: u32,
    pub name: String,
    pub cpuPct: Option<f64>,
    pub rssBytes: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MonitorSample {
    pub sessionId: String,
    pub timestamp: u64,
    pub cpu: Option<MonitorCpuSample>,
    pub memory: MonitorMemorySample,
    pub swap: MonitorSwapSample,
    pub disk: Option<MonitorDiskSample>,
    pub processes: Vec<MonitorProcessSample>,
    pub processTotalCount: usize,
    pub loadAvg: (f64, f64, f64),
    pub uptimeSec: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MonitorStatusEvent {
    pub sessionId: String,
    pub state: String, // "started" | "stopped" | "unsupported" | "error"
    pub message: Option<String>,
}
