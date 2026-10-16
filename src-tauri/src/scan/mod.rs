//! Local, offline discovery of everything installed.

pub mod plugins;
pub mod skills;

use std::path::Path;

use serde_json::Value;

use crate::model::{Item, ScanResult, now_ms};
use crate::settings::Settings;

pub async fn scan_all(settings: &Settings) -> ScanResult {
    let mut warnings = Vec::new();
    let mut items: Vec<Item> = plugins::scan(&mut warnings).await;
    items.extend(skills::scan(settings, &mut warnings));
    items.sort_by_key(|a| a.name.to_lowercase());
    ScanResult {
        items,
        warnings,
        scanned_at: now_ms(),
    }
}

pub fn read_json(path: &Path) -> Option<Value> {
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()
}

/// Name, description and version from a SKILL.md / agent / command front matter block.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct FrontMatter {
    pub name: Option<String>,
    pub description: Option<String>,
    pub version: Option<String>,
}

pub fn front_matter(text: &str) -> FrontMatter {
    let text = text.trim_start_matches('\u{feff}');
    let mut lines = text.lines();
    if lines.next().map(str::trim) != Some("---") {
        return FrontMatter::default();
    }
    let block: Vec<&str> = lines.take_while(|l| l.trim() != "---").collect();
    let block = block.join("\n");

    if let Ok(serde_yaml::Value::Mapping(map)) = serde_yaml::from_str::<serde_yaml::Value>(&block) {
        let get = |k: &str| map.get(k).and_then(yaml_scalar);
        let version =
            get("version").or_else(|| map.get("metadata").and_then(|m| m.get("version")).and_then(yaml_scalar));
        return FrontMatter {
            name: get("name"),
            description: get("description"),
            version,
        };
    }

    // Front matter that isn't valid YAML (unquoted colons are common): read simple `key: value` lines.
    let mut fm = FrontMatter::default();
    for line in block.lines() {
        if line.starts_with(char::is_whitespace) {
            continue;
        }
        if let Some((k, v)) = line.split_once(':') {
            let v = v.trim().trim_matches(|c| c == '"' || c == '\'').to_string();
            if v.is_empty() {
                continue;
            }
            match k.trim() {
                "name" => fm.name = Some(v),
                "description" => fm.description = Some(v),
                "version" => fm.version = Some(v),
                _ => {}
            }
        }
    }
    fm
}

fn yaml_scalar(v: &serde_yaml::Value) -> Option<String> {
    match v {
        serde_yaml::Value::String(s) => Some(s.trim().to_string()),
        serde_yaml::Value::Number(n) => Some(n.to_string()),
        serde_yaml::Value::Bool(b) => Some(b.to_string()),
        _ => None,
    }
    .filter(|s| !s.is_empty())
}

pub fn read_front_matter(path: &Path) -> FrontMatter {
    std::fs::read_to_string(path)
        .map(|t| front_matter(&t))
        .unwrap_or_default()
}

pub fn github_url(repo: &str) -> String {
    format!("https://github.com/{}", repo.trim_end_matches(".git"))
}

/// `https://github.com/owner/repo.git` → `owner/repo`.
pub fn github_repo_from_url(url: &str) -> Option<String> {
    let rest = url
        .strip_prefix("https://github.com/")
        .or_else(|| url.strip_prefix("http://github.com/"))
        .or_else(|| url.strip_prefix("git@github.com:"))?;
    let mut parts = rest.trim_end_matches('/').trim_end_matches(".git").split('/');
    let owner = parts.next().filter(|s| !s.is_empty())?;
    let repo = parts.next().filter(|s| !s.is_empty())?;
    Some(format!("{owner}/{repo}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_yaml_front_matter_with_metadata_version() {
        let fm = front_matter(
            "---\nname: archify\ndescription: Make diagrams.\nlicense: MIT\nmetadata:\n  version: \"2.17\"\n---\n# Body",
        );
        assert_eq!(fm.name.as_deref(), Some("archify"));
        assert_eq!(fm.description.as_deref(), Some("Make diagrams."));
        assert_eq!(fm.version.as_deref(), Some("2.17"));
    }

    #[test]
    fn falls_back_when_yaml_is_invalid() {
        let fm = front_matter("---\nname: x\ndescription: Use when: things: happen\n---\n");
        assert_eq!(fm.name.as_deref(), Some("x"));
        assert_eq!(fm.description.as_deref(), Some("Use when: things: happen"));
    }

    #[test]
    fn no_front_matter() {
        assert_eq!(front_matter("# Title"), FrontMatter::default());
    }

    #[test]
    fn github_repo_parsing() {
        assert_eq!(
            github_repo_from_url("https://github.com/heygen-com/hyperframes.git").as_deref(),
            Some("heygen-com/hyperframes")
        );
        assert_eq!(github_repo_from_url("https://gitlab.com/a/b"), None);
    }
}
