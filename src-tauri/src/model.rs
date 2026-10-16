//! The shape the UI sees. Everything is camelCase on the wire.

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    Plugin,
    Skill,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Source {
    /// Installed with `claude plugin install` from a marketplace.
    Marketplace,
    /// Pushed to this machine by a claude.ai organization.
    Synced,
    /// Installed with the `skills` CLI (tracked in ~/.agents/.skill-lock.json).
    SkillsCli,
    /// A folder in ~/.claude/skills that no installer tracks.
    Local,
    /// A folder in <project>/.claude/skills.
    Project,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Status {
    /// Not checked yet.
    Unchecked,
    UpToDate,
    UpdateAvailable,
    /// Checked, but there was nothing to compare against.
    Unknown,
    /// Updated by someone else (an organization).
    Managed,
    /// No installer tracks it, so there is no upstream to check.
    Untracked,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Child {
    /// skill | command | agent | mcp | hook
    pub kind: String,
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    pub kind: Kind,
    pub source: Source,
    pub name: String,
    pub description: Option<String>,
    pub version: Option<String>,
    pub latest: Option<String>,
    pub status: Status,
    pub status_detail: Option<String>,
    /// Plugins: user | project | local | synced. Skills: global | project.
    pub scope: Option<String>,
    pub enabled: Option<bool>,
    pub path: Option<String>,
    pub repo_url: Option<String>,
    /// Marketplace name for plugins, owner/repo for skills.
    pub origin: Option<String>,
    pub installed_at: Option<String>,
    pub updated_at: Option<String>,
    pub children: Vec<Child>,
    pub notes: Vec<String>,
    /// Extra label/value pairs for the detail panel.
    pub meta: BTreeMap<String, String>,
    #[serde(skip)]
    pub check: CheckInfo,
}

/// What the update checker and the actions need to know, kept out of the wire format.
#[derive(Debug, Clone, Default)]
pub enum CheckInfo {
    #[default]
    None,
    Plugin {
        plugin_id: String,
        marketplace: String,
        name: String,
        installed_version: Option<String>,
        git_sha: Option<String>,
        install_path: Option<PathBuf>,
        scope: String,
        project_path: Option<PathBuf>,
    },
    SkillsCli {
        name: String,
        repo: Option<String>,
        skill_path: String,
        folder_hash: Option<String>,
    },
    ReleaseManifest {
        url: String,
        version: Option<String>,
    },
}

impl Item {
    pub fn new(id: String, kind: Kind, source: Source, name: String) -> Self {
        Item {
            id,
            kind,
            source,
            name,
            description: None,
            version: None,
            latest: None,
            status: Status::Unchecked,
            status_detail: None,
            scope: None,
            enabled: None,
            path: None,
            repo_url: None,
            origin: None,
            installed_at: None,
            updated_at: None,
            children: Vec::new(),
            notes: Vec::new(),
            meta: BTreeMap::new(),
            check: CheckInfo::None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub items: Vec<Item>,
    pub warnings: Vec<String>,
    pub scanned_at: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckResult {
    pub items: Vec<Item>,
    pub warnings: Vec<String>,
    pub checked_at: u64,
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
