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
    /// The skill's repo or folder moved upstream; reinstall from `Item.upstream`.
    Moved,
    /// The skill was deleted upstream; `Item.upstream.commit` is the commit that removed it.
    Removed,
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
    /// Plugins only: size of the plugin's data folder, `None` when it's missing or empty.
    pub data_bytes: Option<u64>,
    /// A Claude Code mod: a plugin whose `hooks/hooks.json` loads UI modules.
    pub is_mod: bool,
    /// Rough tokens this item adds to every session while it's on.
    pub cost: Option<crate::cost::Cost>,
    /// Problems that stop the item from loading the way it should.
    pub issues: Vec<Issue>,
    /// Set with `Status::Moved` / `Status::Removed`.
    pub upstream: Option<Upstream>,
    #[serde(skip)]
    pub check: CheckInfo,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    /// no-frontmatter | bad-frontmatter | no-description | long-description | link-missing | link-replaced | duplicate-name
    pub code: String,
    pub message: String,
}

/// Where a skill went upstream, or the commit that deleted it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Upstream {
    /// owner/repo the skill lives in now.
    pub repo: String,
    /// Its folder in that repo ("" for the repo root).
    pub folder: Option<String>,
    pub commit: Option<crate::updates::changelog::Entry>,
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
            data_bytes: None,
            is_mod: false,
            cost: None,
            issues: Vec::new(),
            upstream: None,
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
