use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ImportedSite {
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub source: String,
}

#[cfg(target_os = "windows")]
pub fn scan_winscp_sessions() -> Result<Vec<ImportedSite>, Box<dyn std::error::Error>> {
    use winreg::enums::*;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let winscp_key = match hkcu.open_subkey("Software\\Martin Prikryl\\WinSCP 2\\Sessions") {
        Ok(key) => key,
        Err(_) => return Ok(Vec::new()),
    };

    let mut results = Vec::new();
    for subkey_name in winscp_key.enum_keys().filter_map(|x| x.ok()) {
        if let Ok(session) = winscp_key.open_subkey(&subkey_name) {
            let host: String = session.get_value("HostName").unwrap_or_default();
            let username: String = session.get_value("UserName").unwrap_or_default();
            let port: u32 = session.get_value("PortNumber").unwrap_or(22);

            if !host.is_empty() {
                results.push(ImportedSite {
                    name: subkey_name,
                    host,
                    port: port as u16,
                    username,
                    source: "WinSCP".to_string(),
                });
            }
        }
    }
    Ok(results)
}

#[cfg(not(target_os = "windows"))]
pub fn scan_winscp_sessions() -> Result<Vec<ImportedSite>, Box<dyn std::error::Error>> {
    Ok(Vec::new())
}
