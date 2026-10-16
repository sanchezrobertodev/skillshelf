//! Plugins: `claude plugin list --json` is the source of truth, merged with
//! installed_plugins.json for the commit each plugin was installed from.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Deserialize;
use serde_json::Value;

use super::{github_repo_from_url, github_url, read_front_matter, read_json};
use crate::model::{CheckInfo, Child, Item, Kind, Source};
use crate::{paths, proc};

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CliPlugin {
    pub id: String,
    pub version: Option<String>,
    pub scope: Option<String>,
    pub enabled: Option<bool>,
    pub install_path: Option<String>,
    pub installed_at: Option<String>,
    pub last_updated: Option<String>,
    pub mcp_servers: Option<serde_json::Map<String, Value>>,
    #[serde(default)]
    pub notes: Vec<String>,
    pub project_path: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InstalledEntry {
    pub scope: Option<String>,
    pub install_path: Option<String>,
    pub version: Option<String>,
    pub installed_at: Option<String>,
    pub last_updated: Option<String>,
    pub git_commit_sha: Option<String>,
    pub project_path: Option<String>,
}

pub fn read_installed() -> HashMap<String, Vec<InstalledEntry>> {
    read_json(&paths::installed_plugins_file())
        .and_then(|v| v.get("plugins").cloned())
        .and_then(|p| serde_json::from_value(p).ok())
        .unwrap_or_default()
}

pub async fn list_from_cli() -> Result<Vec<CliPlugin>, String> {
    let out = proc::run("claude", &["plugin", "list", "--json"], None, Duration::from_secs(90)).await?;
    if !out.success() {
        return Err(format!("`claude plugin list` failed: {}", out.stderr.trim()));
    }
    let start = out
        .stdout
        .find('[')
        .ok_or("`claude plugin list --json` printed no JSON")?;
    serde_json::from_str(&out.stdout[start..]).map_err(|e| format!("could not parse plugin list: {e}"))
}

pub async fn scan(warnings: &mut Vec<String>) -> Vec<Item> {
    let installed = read_installed();
    let listed = match list_from_cli().await {
        Ok(list) => list,
        Err(e) => {
            warnings.push(format!("{e}. Showing plugins from installed_plugins.json instead."));
            fallback_list(&installed)
        }
    };
    let known = read_json(&paths::known_marketplaces_file()).unwrap_or(Value::Null);
    listed.into_iter().map(|p| to_item(p, &installed, &known)).collect()
}

/// Used when the `claude` CLI isn't available.
fn fallback_list(installed: &HashMap<String, Vec<InstalledEntry>>) -> Vec<CliPlugin> {
    let enabled = read_json(&paths::user_settings_file())
        .and_then(|s| s.get("enabledPlugins").cloned())
        .unwrap_or(Value::Null);
    installed
        .iter()
        .flat_map(|(id, entries)| {
            let enabled = &enabled;
            entries.iter().map(move |e| CliPlugin {
                id: id.clone(),
                version: e.version.clone(),
                scope: e.scope.clone(),
                enabled: enabled.get(id).and_then(Value::as_bool),
                install_path: e.install_path.clone(),
                installed_at: e.installed_at.clone(),
                last_updated: e.last_updated.clone(),
                project_path: e.project_path.clone(),
                ..Default::default()
            })
        })
        .collect()
}

fn to_item(p: CliPlugin, installed: &HashMap<String, Vec<InstalledEntry>>, known: &Value) -> Item {
    let (name, marketplace) = split_id(&p.id);
    let scope = p.scope.clone().unwrap_or_else(|| "user".into());
    let synced = scope == "synced" || marketplace == "synced";

    let entry = installed.get(&p.id).and_then(|entries| {
        entries
            .iter()
            .find(|e| e.install_path.is_some() && e.install_path == p.install_path)
            .or_else(|| entries.iter().find(|e| e.scope.as_deref() == Some(scope.as_str())))
            .cloned()
    });

    let mut item = Item::new(
        format!("plugin:{}:{}", p.id, scope),
        Kind::Plugin,
        if synced { Source::Synced } else { Source::Marketplace },
        name.clone(),
    );
    item.version = p.version.clone();
    item.scope = Some(scope.clone());
    item.enabled = p.enabled;
    item.origin = Some(marketplace.clone());
    item.installed_at = p.installed_at.clone();
    item.updated_at = p.last_updated.clone();
    item.notes = p.notes.clone();
    item.meta.insert("Plugin id".into(), p.id.clone());

    let install_path = p.install_path.as_ref().map(PathBuf::from);
    if let Some(path) = &install_path {
        item.path = Some(path.display().to_string());
        let manifest = read_json(&path.join(".claude-plugin").join("plugin.json")).unwrap_or(Value::Null);
        item.description = manifest.get("description").and_then(Value::as_str).map(str::to_string);
        if item.version.is_none() {
            item.version = manifest.get("version").and_then(Value::as_str).map(str::to_string);
        }
        if let Some(author) = manifest
            .pointer("/author/name")
            .or_else(|| manifest.get("author"))
            .and_then(Value::as_str)
        {
            item.meta.insert("Author".into(), author.to_string());
        }
        if let Some(license) = manifest.get("license").and_then(Value::as_str) {
            item.meta.insert("License".into(), license.to_string());
        }
        item.repo_url = manifest_repo(&manifest);
        item.children = children(path, &manifest, p.mcp_servers.as_ref());
    }

    if item.repo_url.is_none() {
        item.repo_url = known
            .get(&marketplace)
            .and_then(|m| m.pointer("/source/repo"))
            .and_then(Value::as_str)
            .map(github_url);
    }

    let project_path = p
        .project_path
        .clone()
        .or_else(|| entry.as_ref().and_then(|e| e.project_path.clone()))
        .map(PathBuf::from);
    if let Some(pp) = &project_path {
        item.meta.insert("Project".into(), pp.display().to_string());
    }
    let git_sha = entry.as_ref().and_then(|e| e.git_commit_sha.clone());
    if let Some(sha) = &git_sha {
        item.meta
            .insert("Installed commit".into(), sha.chars().take(12).collect());
    }

    item.check = CheckInfo::Plugin {
        plugin_id: p.id.clone(),
        marketplace,
        name,
        installed_version: item.version.clone(),
        git_sha,
        install_path,
        scope,
        project_path,
    };
    item
}

pub fn split_id(id: &str) -> (String, String) {
    match id.rsplit_once('@') {
        Some((name, mkt)) => (name.to_string(), mkt.to_string()),
        None => (id.to_string(), String::new()),
    }
}

fn manifest_repo(manifest: &Value) -> Option<String> {
    let raw = manifest
        .get("repository")
        .and_then(|r| r.as_str().or_else(|| r.get("url").and_then(Value::as_str)))
        .or_else(|| manifest.get("homepage").and_then(Value::as_str))?;
    if let Some(repo) = github_repo_from_url(raw) {
        return Some(github_url(&repo));
    }
    raw.starts_with("http").then(|| raw.to_string())
}

/// Skills, commands, agents, MCP servers and hooks a plugin ships.
pub fn children(root: &Path, manifest: &Value, mcp_from_cli: Option<&serde_json::Map<String, Value>>) -> Vec<Child> {
    let mut out = Vec::new();

    for dir in subdirs(&root.join("skills")) {
        let skill_md = dir.join("SKILL.md");
        if skill_md.is_file() {
            let fm = read_front_matter(&skill_md);
            out.push(Child {
                kind: "skill".into(),
                name: fm.name.unwrap_or_else(|| file_name(&dir)),
                description: fm.description,
            });
        }
    }
    for (kind, dir) in [("command", "commands"), ("agent", "agents")] {
        for file in markdown_files(&root.join(dir)) {
            let fm = read_front_matter(&file);
            out.push(Child {
                kind: kind.into(),
                name: fm.name.unwrap_or_else(|| file_stem(&file)),
                description: fm.description,
            });
        }
    }

    let mut mcp: Vec<String> = mcp_from_cli.map(|m| m.keys().cloned().collect()).unwrap_or_default();
    if mcp.is_empty() {
        let from_file = read_json(&root.join(".mcp.json"))
            .and_then(|v| v.get("mcpServers").cloned().or(Some(v)))
            .or_else(|| manifest.get("mcpServers").cloned());
        if let Some(Value::Object(map)) = from_file {
            mcp = map.keys().cloned().collect();
        }
    }
    out.extend(mcp.into_iter().map(|name| Child {
        kind: "mcp".into(),
        name,
        description: None,
    }));

    if let Some(Value::Object(hooks)) =
        read_json(&root.join("hooks").join("hooks.json")).and_then(|v| v.get("hooks").cloned())
    {
        out.extend(hooks.keys().map(|event| Child {
            kind: "hook".into(),
            name: event.clone(),
            description: None,
        }));
    }
    out
}

fn subdirs(dir: &Path) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();
    v.sort();
    v
}

fn markdown_files(dir: &Path) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e == "md"))
        .collect();
    v.sort();
    v
}

fn file_name(p: &Path) -> String {
    p.file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn file_stem(p: &Path) -> String {
    p.file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_cli_list_output() {
        let json = r#"[{"id":"runpod@runpod","version":"1.2.0","scope":"user","enabled":true,
            "installPath":"C:\\x","installedAt":"2026-08-30T19:18:35.518Z","lastUpdated":"2026-08-30T19:18:35.518Z",
            "mcpServers":{"runpod":{"type":"http","url":"https://mcp.getrunpod.io/"}},"projectEnabled":false},
            {"id":"design@synced","version":"1.2.0","scope":"synced","enabled":true,"installPath":"C:\\y"}]"#;
        let list: Vec<CliPlugin> = serde_json::from_str(json).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].mcp_servers.as_ref().unwrap().len(), 1);
        let item = to_item(list.into_iter().nth(1).unwrap(), &HashMap::new(), &Value::Null);
        assert_eq!(item.source, Source::Synced);
        assert_eq!(item.id, "plugin:design@synced:synced");
    }

    #[test]
    fn splits_plugin_ids() {
        assert_eq!(
            split_id("frontend-design@claude-plugins-official"),
            ("frontend-design".into(), "claude-plugins-official".into())
        );
    }

    #[test]
    fn reads_children_from_plugin_folder() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("skills/alpha")).unwrap();
        std::fs::write(
            root.join("skills/alpha/SKILL.md"),
            "---\nname: alpha\ndescription: A\n---\n",
        )
        .unwrap();
        std::fs::create_dir_all(root.join("commands")).unwrap();
        std::fs::write(root.join("commands/go.md"), "# go").unwrap();
        std::fs::write(root.join(".mcp.json"), r#"{"mcpServers":{"srv":{}}}"#).unwrap();
        let kids = children(root, &Value::Null, None);
        let names: Vec<_> = kids.iter().map(|c| format!("{}:{}", c.kind, c.name)).collect();
        assert_eq!(names, ["skill:alpha", "command:go", "mcp:srv"]);
    }
}
