//! App preferences, stored as JSON in the OS app-config folder.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Project folders whose `.claude/skills` are scanned too.
    pub projects: Vec<String>,
    /// Check for updates at launch and every `check_interval`. Off: only when asked.
    pub auto_check: bool,
    pub check_interval: CheckInterval,
    /// Closing the window hides it to the tray instead of quitting.
    pub close_to_tray: bool,
    /// Announce new updates with an OS notification.
    pub notifications: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CheckInterval {
    Daily,
    Weekly,
}

impl CheckInterval {
    pub fn ms(self) -> u64 {
        const DAY_MS: u64 = 24 * 60 * 60 * 1000;
        match self {
            CheckInterval::Daily => DAY_MS,
            CheckInterval::Weekly => 7 * DAY_MS,
        }
    }
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            projects: Vec::new(),
            auto_check: true,
            check_interval: CheckInterval::Daily,
            close_to_tray: true,
            notifications: true,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_from_older_versions_keep_their_values() {
        let s: Settings = serde_json::from_str(r#"{"projects":["C:\\p"],"autoCheck":false}"#).unwrap();
        assert_eq!((s.projects.len(), s.auto_check), (1, false));
        assert_eq!(s.check_interval, CheckInterval::Daily);
        assert!(s.close_to_tray && s.notifications);
    }
}
