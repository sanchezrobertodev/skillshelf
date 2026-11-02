//! Update risk flags: what an update adds or changes that runs without asking first.
//! hooks, MCP servers, scripts, and the tools a skill pre-approves (`allowed-tools`).

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};

use serde::Serialize;

use super::plugins::IGNORED;
use crate::scan::front_matter_block;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RiskKind {
    Hooks,
    Mcp,
    Scripts,
    AllowedTools,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Risk {
    pub kind: RiskKind,
    /// Paths relative to the plugin or skill folder.
    pub files: Vec<String>,
    /// English. The UI shows its own text for `kind`, plus `added` and `removed`.
    pub why: String,
    /// Allowed tools an update adds or removes.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub added: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub removed: Vec<String>,
}

/// Before and after contents of a changed file; `None` where it doesn't exist.
pub type Contents = HashMap<String, (Option<String>, Option<String>)>;

const SCRIPT_EXTENSIONS: &[&str] = &[
    "sh", "bash", "zsh", "fish", "ps1", "psm1", "py", "js", "mjs", "cjs", "ts", "tsx", "jsx", "cmd", "bat", "exe",
    "rb", "pl",
];

fn why(kind: RiskKind) -> &'static str {
    match kind {
        RiskKind::Hooks => "Hooks run commands automatically on Claude Code events, without asking first.",
        RiskKind::Mcp => "MCP servers give Claude new tools and can start programs or connect to the internet.",
        RiskKind::Scripts => "Scripts and programs can run on your computer when the plugin or skill uses them.",
        RiskKind::AllowedTools => "Tools listed in a skill's allowed-tools run without a permission prompt.",
    }
}

fn file_name(path: &str) -> String {
    path.rsplit('/').next().unwrap_or(path).to_ascii_lowercase()
}

fn by_path(path: &str) -> Option<RiskKind> {
    let lower = path.to_ascii_lowercase();
    let name = file_name(&lower);
    let dirs = || lower.split('/').rev().skip(1);
    // plugin.json can declare hook files under any name; they live in hooks/ by convention.
    if name == "hooks.json" || (name.ends_with(".json") && dirs().any(|dir| dir == "hooks")) {
        return Some(RiskKind::Hooks);
    }
    // plugin.json mcpServers may also name MCPB bundles.
    if name == ".mcp.json" || name.ends_with(".mcpb") || name.ends_with(".dxt") {
        return Some(RiskKind::Mcp);
    }
    let in_script_dir = dirs().any(|dir| dir == "bin" || dir == "scripts");
    let ext = name.rsplit_once('.').map(|(_, e)| e);
    (in_script_dir || ext.is_some_and(|e| SCRIPT_EXTENSIONS.contains(&e))).then_some(RiskKind::Scripts)
}

/// Where a plugin's manifest lives, relative to the plugin folder.
// shortcut: a manifest committed under another case (PLUGIN.JSON, which Windows and macOS still load) isn't found, so its declared files fall back to by_path; look it up case-insensitively if such a plugin shows up.
pub const PLUGIN_JSON: &str = ".claude-plugin/plugin.json";

/// A relative path as Claude Code resolves it: `\` and `/` alike, `.` and `..` applied. Lowercased
/// because Windows and macOS match file names case-insensitively; on Linux that over-flags, the safe side.
fn normalize(p: &str) -> String {
    let mut parts = Vec::new();
    for part in p.split(['/', '\\']) {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            _ => parts.push(part),
        }
    }
    parts.join("/").to_lowercase()
}

// shortcut: files a marketplace entry declares (strict: false) aren't read, pass the entry's fields once such a plugin shows up
/// Files a plugin.json declares under `key` (`hooks`, `mcpServers`), normalized, relative to the plugin folder.
fn declared(plugin_json: Option<&str>, key: &str) -> Vec<String> {
    let v: serde_json::Value = plugin_json
        .and_then(|t| serde_json::from_str(t).ok())
        .unwrap_or_default();
    let paths: Vec<&str> = match v.get(key) {
        Some(serde_json::Value::String(s)) => vec![s],
        Some(serde_json::Value::Array(a)) => a.iter().filter_map(|p| p.as_str()).collect(),
        _ => Vec::new(),
    };
    paths.iter().map(|p| normalize(p)).collect()
}

/// Risks in an update, from the paths that differ and the contents of the files whose meaning
/// depends on what's inside (`plugin.json` and `SKILL.md`). `contents` may also hold an unchanged
/// [`PLUGIN_JSON`], so hook and MCP files it declares under other names count as hooks and MCP.
pub fn assess(changed: &[String], contents: &Contents) -> Vec<Risk> {
    let (b, a) = contents.get(PLUGIN_JSON).cloned().unwrap_or_default();
    let both = |key| [declared(b.as_deref(), key), declared(a.as_deref(), key)].concat();
    let (hook_files, mcp_files) = (both("hooks"), both("mcpServers"));
    let mut found: BTreeMap<RiskKind, (Vec<String>, Vec<String>)> = BTreeMap::new();
    let mut add = |kind, file: &str, detail: Option<String>| {
        let (files, details) = found.entry(kind).or_default();
        if !files.iter().any(|f| f == file) {
            files.push(file.to_string());
        }
        details.extend(detail);
    };
    let (mut tools_added, mut tools_removed) = (Vec::new(), Vec::new());
    for path in changed {
        // A declared file wins over by_path, so a hook file under scripts/ is reported as a hook.
        let norm = normalize(path);
        let kind = if hook_files.contains(&norm) {
            Some(RiskKind::Hooks)
        } else if mcp_files.contains(&norm) {
            Some(RiskKind::Mcp)
        } else {
            by_path(path)
        };
        if let Some(kind) = kind {
            add(kind, path, None);
        }
        let (before, after) = contents.get(path).cloned().unwrap_or_default();
        match file_name(path).as_str() {
            "plugin.json" => {
                let parse = |s: Option<String>| -> serde_json::Value {
                    s.and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
                };
                let (b, a) = (parse(before), parse(after));
                for (key, kind) in [("hooks", RiskKind::Hooks), ("mcpServers", RiskKind::Mcp)] {
                    if b.get(key) != a.get(key) {
                        add(kind, path, None);
                    }
                }
            }
            "skill.md" => {
                let (b, a) = (allowed_tools(before.as_deref()), allowed_tools(after.as_deref()));
                let added: Vec<&str> = a.iter().filter(|t| !b.contains(t)).map(String::as_str).collect();
                let removed: Vec<&str> = b.iter().filter(|t| !a.contains(t)).map(String::as_str).collect();
                tools_added.extend(added.iter().map(|t| t.to_string()));
                tools_removed.extend(removed.iter().map(|t| t.to_string()));
                if !added.is_empty() || !removed.is_empty() {
                    let mut parts = Vec::new();
                    if !added.is_empty() {
                        parts.push(format!("adds {}", added.join(", ")));
                    }
                    if !removed.is_empty() {
                        parts.push(format!("removes {}", removed.join(", ")));
                    }
                    add(
                        RiskKind::AllowedTools,
                        path,
                        Some(format!("{path} {}.", parts.join(" and "))),
                    );
                }
            }
            _ => {}
        }
    }
    found
        .into_iter()
        .map(|(kind, (files, details))| {
            let tools = kind == RiskKind::AllowedTools;
            Risk {
                kind,
                files,
                why: std::iter::once(why(kind).to_string())
                    .chain(details)
                    .collect::<Vec<_>>()
                    .join(" "),
                added: if tools {
                    std::mem::take(&mut tools_added)
                } else {
                    Vec::new()
                },
                removed: if tools {
                    std::mem::take(&mut tools_removed)
                } else {
                    Vec::new()
                },
            }
        })
        .collect()
}

/// `allowed-tools` from front matter, as a list (it may be written as a list or a comma/space-separated string).
fn allowed_tools(skill_md: Option<&str>) -> Vec<String> {
    let block = skill_md.and_then(front_matter_block).unwrap_or_default();
    let Ok(serde_yaml::Value::Mapping(map)) = serde_yaml::from_str::<serde_yaml::Value>(&block) else {
        return Vec::new();
    };
    match map.get("allowed-tools") {
        Some(serde_yaml::Value::Sequence(list)) => list
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.trim().to_string()))
            .collect(),
        Some(serde_yaml::Value::String(s)) => split_tools(s),
        _ => Vec::new(),
    }
}

/// `Bash(git add:*), Read Write` → each tool, keeping spaces inside parentheses.
fn split_tools(s: &str) -> Vec<String> {
    let (mut out, mut cur, mut depth) = (Vec::new(), String::new(), 0);
    for c in s.chars() {
        match c {
            '(' => depth += 1,
            ')' => depth -= 1,
            ',' | ' ' if depth == 0 => {
                if !cur.trim().is_empty() {
                    out.push(cur.trim().to_string());
                }
                cur.clear();
                continue;
            }
            _ => {}
        }
        cur.push(c);
    }
    if !cur.trim().is_empty() {
        out.push(cur.trim().to_string());
    }
    out
}

/// Risks between an installed folder and the folder it would be updated from, both on disk.
pub fn between_folders(installed: &Path, latest: &Path) -> Vec<Risk> {
    let (old, new) = (files(installed), files(latest));
    let mut changed: Vec<String> = old
        .keys()
        .chain(new.keys())
        .filter(|rel| match (old.get(*rel), new.get(*rel)) {
            (Some(a), Some(b)) => std::fs::read(a).ok() != std::fs::read(b).ok(),
            _ => true,
        })
        .cloned()
        .collect();
    changed.sort();
    changed.dedup();
    let read = |m: &BTreeMap<String, PathBuf>, rel: &str| m.get(rel).and_then(|p| std::fs::read_to_string(p).ok());
    let contents = changed
        .iter()
        .filter(|rel| matches!(file_name(rel).as_str(), "plugin.json" | "skill.md"))
        .map(String::as_str)
        .chain([PLUGIN_JSON])
        .map(|rel| (rel.to_string(), (read(&old, rel), read(&new, rel))))
        .collect();
    assess(&changed, &contents)
}

fn files(root: &Path) -> BTreeMap<String, PathBuf> {
    let mut out = BTreeMap::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for entry in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
            if IGNORED.contains(&entry.file_name().to_string_lossy().as_ref()) {
                continue;
            }
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if let Ok(rel) = path.strip_prefix(root) {
                out.insert(rel.to_string_lossy().replace('\\', "/"), path);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(r: &[Risk]) -> Vec<RiskKind> {
        r.iter().map(|r| r.kind).collect()
    }

    #[test]
    fn classifies_changed_paths() {
        let changed: Vec<String> = [
            "hooks/hooks.json",
            "hooks/session-start.mjs",
            "bin/tool",
            "skills/x/scripts/run.txt",
            ".mcp.json",
            "README.md",
            "skills/x/references/guide.md",
        ]
        .map(String::from)
        .into();
        let r = assess(&changed, &Contents::new());
        assert_eq!(kinds(&r), [RiskKind::Hooks, RiskKind::Mcp, RiskKind::Scripts]);
        assert_eq!(
            r[2].files,
            ["hooks/session-start.mjs", "bin/tool", "skills/x/scripts/run.txt"]
        );
    }

    #[test]
    fn json_files_in_hooks_folder_are_hooks() {
        assert_eq!(by_path("hooks/claude-codex-hooks.json"), Some(RiskKind::Hooks));
        assert_eq!(by_path("hooks/session-start.mjs"), Some(RiskKind::Scripts));
        assert_eq!(by_path("server.mcpb"), Some(RiskKind::Mcp));
    }

    #[test]
    fn hook_files_plugin_json_declares_are_hooks() {
        let changed: Vec<String> = ["config/band.json", "config/servers.json", "scripts/x.json"]
            .map(String::from)
            .into();
        let manifest = r#"{"hooks":["./Config/./Band.json","./scripts/x.json"],"mcpServers":"./config/servers.json"}"#;
        let mut contents = Contents::new();
        contents.insert(PLUGIN_JSON.into(), (Some(manifest.into()), Some(manifest.into())));
        let r = assess(&changed, &contents);
        assert_eq!(kinds(&r), [RiskKind::Hooks, RiskKind::Mcp]);
        assert_eq!(r[0].files, ["config/band.json", "scripts/x.json"]);
        assert!(assess(&changed[..2], &Contents::new()).is_empty());
        assert_eq!(normalize("./Config/Über.json"), "config/über.json");
        assert_eq!(normalize("a\\..\\hooks/x.json"), "hooks/x.json");
    }

    #[test]
    fn plugin_json_and_allowed_tools_are_judged_by_content() {
        let changed: Vec<String> = vec![".claude-plugin/plugin.json".into(), "SKILL.md".into()];
        let mut contents = Contents::new();
        contents.insert(
            changed[0].clone(),
            (
                Some(r#"{"version":"1"}"#.into()),
                Some(r#"{"version":"2","mcpServers":{"a":{}}}"#.into()),
            ),
        );
        contents.insert(
            changed[1].clone(),
            (
                Some("---\nname: x\nallowed-tools: Read, Bash(git log:*)\n---\n".into()),
                Some("---\nname: x\nallowed-tools:\n  - Read\n  - Bash(rm:*)\n---\n".into()),
            ),
        );
        let r = assess(&changed, &contents);
        assert_eq!(kinds(&r), [RiskKind::Mcp, RiskKind::AllowedTools]);
        assert!(
            r[1].why
                .ends_with("SKILL.md adds Bash(rm:*) and removes Bash(git log:*)."),
            "{}",
            r[1].why
        );
        assert_eq!(
            (r[1].added.as_slice(), r[1].removed.as_slice()),
            (
                ["Bash(rm:*)".to_string()].as_slice(),
                ["Bash(git log:*)".to_string()].as_slice()
            )
        );

        // A version bump alone isn't a risk.
        contents.insert(
            changed[0].clone(),
            (Some(r#"{"version":"1"}"#.into()), Some(r#"{"version":"2"}"#.into())),
        );
        contents.remove("SKILL.md");
        assert!(assess(&changed[..1], &contents).is_empty());
    }

    #[test]
    fn compares_two_folders_on_disk() {
        let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        for d in [a.path(), b.path()] {
            std::fs::create_dir_all(d.join("hooks")).unwrap();
            std::fs::write(d.join("README.md"), "same").unwrap();
            std::fs::create_dir_all(d.join("node_modules")).unwrap();
        }
        std::fs::write(b.path().join("hooks/hooks.json"), "{}").unwrap();
        std::fs::write(b.path().join("node_modules/x.js"), "ignored").unwrap();
        let r = between_folders(a.path(), b.path());
        assert_eq!(kinds(&r), [RiskKind::Hooks]);
        assert!(between_folders(a.path(), a.path()).is_empty());
    }
}
