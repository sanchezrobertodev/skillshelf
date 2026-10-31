//! Locations of the files Claude Code and the `skills` CLI keep on disk.

use std::path::{Path, PathBuf};

pub fn home() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

/// `~/.claude`, or `$CLAUDE_CONFIG_DIR` when set.
pub fn claude_dir() -> PathBuf {
    std::env::var_os("CLAUDE_CONFIG_DIR")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| home().join(".claude"))
}

pub fn plugins_dir() -> PathBuf {
    claude_dir().join("plugins")
}

/// The folder Claude Code gives a plugin for data it keeps across updates (`${CLAUDE_PLUGIN_DATA}`).
/// Its name is the plugin id with characters outside `a-zA-Z0-9_-` replaced by `-`.
pub fn plugin_data_dir(plugin_id: &str) -> PathBuf {
    let name: String = plugin_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '-'
            }
        })
        .collect();
    plugins_dir().join("data").join(name)
}

/// Size of a plugin's data folder, or `None` when it's missing or empty (an empty file still counts as data).
pub fn plugin_data_size(plugin_id: &str) -> Option<u64> {
    let dir = plugin_data_dir(plugin_id);
    let has_entries = std::fs::read_dir(&dir).is_ok_and(|mut d| d.next().is_some());
    has_entries.then(|| dir_size(&dir))
}

/// Total size of the files under `dir`, without following links. 0 when it's missing.
fn dir_size(dir: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(dir) else { return 0 };
    entries
        .flatten()
        .map(|e| match e.file_type() {
            Ok(t) if t.is_dir() => dir_size(&e.path()),
            Ok(t) if t.is_file() => e.metadata().map_or(0, |m| m.len()),
            _ => 0,
        })
        .sum()
}

pub fn installed_plugins_file() -> PathBuf {
    plugins_dir().join("installed_plugins.json")
}

pub fn known_marketplaces_file() -> PathBuf {
    plugins_dir().join("known_marketplaces.json")
}

pub fn user_settings_file() -> PathBuf {
    claude_dir().join("settings.json")
}

pub fn user_skills_dir() -> PathBuf {
    claude_dir().join("skills")
}

/// Where the `skills` CLI keeps global installs; `~/.claude/skills/<name>` links here.
pub fn agents_skills_dir() -> PathBuf {
    home().join(".agents").join("skills")
}

/// Lockfile written by the `skills` CLI (vercel-labs/skills) for global installs.
pub fn skill_lock_file() -> PathBuf {
    home().join(".agents").join(".skill-lock.json")
}
