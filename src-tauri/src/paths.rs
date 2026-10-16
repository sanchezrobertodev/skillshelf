//! Locations of the files Claude Code and the `skills` CLI keep on disk.

use std::path::PathBuf;

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

/// Lockfile written by the `skills` CLI (vercel-labs/skills) for global installs.
pub fn skill_lock_file() -> PathBuf {
    home().join(".agents").join(".skill-lock.json")
}
