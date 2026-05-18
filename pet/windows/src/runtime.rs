use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInfo {
    pub port: u16,
    pub pid: u32,
    pub started_at: u64,
}

impl RuntimeInfo {
    pub fn load(path: &Path) -> io::Result<Self> {
        let raw = fs::read_to_string(path)?;
        serde_json::from_str(&raw)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
    }
}

pub struct RuntimeFile {
    path: PathBuf,
}

impl RuntimeFile {
    pub fn write(path: &Path, info: RuntimeInfo) -> io::Result<Self> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let raw = serde_json::to_string_pretty(&info)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
        fs::write(path, raw)?;
        Ok(Self {
            path: path.to_path_buf(),
        })
    }
}

impl Drop for RuntimeFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}
