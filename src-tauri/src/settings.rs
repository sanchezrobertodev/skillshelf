//! App preferences, stored as JSON in the OS app-config folder.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Project folders whose `.claude/skills` are scanned too.
    pub projects: Vec<String>,
    /// Check for updates automatically after each scan.
    pub auto_check: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            projects: Vec::new(),
            auto_check: true,
        }
    }
}

impl Settings {
    pub fn load(file: &PathBuf) -> Self {
        std::fs::read_to_string(file)
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, file: &PathBuf) -> Result<(), String> {
        if let Some(dir) = file.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        std::fs::write(file, json).map_err(|e| format!("could not save settings: {e}"))
    }
}
