//! Local, offline discovery of everything installed.

pub mod plugins;
pub mod skills;

use std::path::Path;

use serde_json::Value;

use crate::model::{Item, ScanResult, Status, now_ms};
use crate::settings::Settings;

pub async fn scan_all(settings: &Settings) -> ScanResult {
    let mut warnings = Vec::new();
    let mut items: Vec<Item> = plugins::scan(&mut warnings).await;
    items.extend(skills::scan(settings, &mut warnings));
    items.sort_by_key(|a| a.name.to_lowercase());
    for item in &mut items {
        item.cost = crate::cost::estimate(item);
    }
    crate::health::check(&mut items);
    ScanResult {
        items,
        warnings,
        scanned_at: now_ms(),
    }
}

/// Keeps the last check's verdict on items a rescan found at the same version, until the next check
/// replaces it. A moved skill keeps `upstream`, so Reinstall still goes to where it lives now.
pub fn keep_verdicts(prev: &[Item], items: &mut [Item]) {
    for item in items.iter_mut().filter(|i| i.status == Status::Unchecked) {
        if let Some(p) = prev
            .iter()
            .find(|p| p.id == item.id && p.version == item.version && p.status != Status::Unchecked)
        {
            item.status = p.status;
            item.latest = p.latest.clone();
            item.status_detail = p.status_detail.clone();
            item.upstream = p.upstream.clone();
        }
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

/// The YAML between the opening and closing `---` lines, or `None` when the file doesn't start with one.
pub fn front_matter_block(text: &str) -> Option<String> {
    let mut lines = text.trim_start_matches('\u{feff}').lines();
    if lines.next().map(str::trim) != Some("---") {
        return None;
    }
    let block: Vec<&str> = lines.take_while(|l| l.trim() != "---").collect();
    Some(block.join("\n"))
}

/// The text after the front matter block (all of it when there's no closed block).
pub fn without_front_matter(text: &str) -> &str {
    let text = text.trim_start_matches('\u{feff}');
    let mut lines = text.split_inclusive('\n');
    let Some(first) = lines.next().filter(|l| l.trim() == "---") else {
        return text;
    };
    let mut offset = first.len();
    for line in lines {
        offset += line.len();
        if line.trim() == "---" {
            return &text[offset..];
        }
    }
    text
}

pub fn front_matter(text: &str) -> FrontMatter {
    let Some(block) = front_matter_block(text) else {
        return FrontMatter::default();
    };

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

/// `owner/repo` for GitHub https, ssh and scp-style URLs.
pub fn github_repo_from_url(url: &str) -> Option<String> {
    let url = url.trim();
    let rest = [
        "https://github.com/",
        "http://github.com/",
        "ssh://git@github.com/",
        "git@github.com:",
    ]
    .iter()
    .find_map(|p| url.strip_prefix(p))?;
    let mut parts = rest.split('/');
    let owner = parts.next().filter(|s| !s.is_empty())?;
    let repo = parts.next()?.trim_end_matches(".git");
    (!repo.is_empty()).then(|| format!("{owner}/{repo}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Kind, Source, Upstream};

    #[test]
    fn rescans_keep_the_last_verdict_until_the_version_changes() {
        let skill = |version: &str| {
            let mut i = Item::new("skill:x".into(), Kind::Skill, Source::SkillsCli, "x".into());
            i.version = Some(version.into());
            i
        };
        let mut checked = skill("1");
        checked.status = Status::Moved;
        checked.upstream = Some(Upstream {
            repo: "new/home".into(),
            folder: None,
            commit: None,
        });

        let mut same = [skill("1")];
        keep_verdicts(std::slice::from_ref(&checked), &mut same);
        assert_eq!(same[0].status, Status::Moved);
        assert_eq!(same[0].upstream.as_ref().unwrap().repo, "new/home");

        let mut updated = [skill("2")];
        keep_verdicts(&[checked], &mut updated);
        assert_eq!(
            (updated[0].status, updated[0].upstream.is_none()),
            (Status::Unchecked, true)
        );
    }

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
    fn strips_front_matter() {
        assert_eq!(without_front_matter("---\nname: a\n---\n# Body\n"), "# Body\n");
        assert_eq!(without_front_matter("# Body"), "# Body");
        assert_eq!(without_front_matter("---\nunclosed"), "---\nunclosed");
    }

    #[test]
    fn github_repo_parsing() {
        for url in [
            "https://github.com/o/r.git",
            "https://github.com/o/r",
            "https://github.com/o/r/",
            "git@github.com:o/r.git",
            "ssh://git@github.com/o/r",
            " https://github.com/o/r.git\n",
            "https://github.com/o/r/tree/main/x",
        ] {
            assert_eq!(github_repo_from_url(url).as_deref(), Some("o/r"), "{url}");
        }
        assert_eq!(github_repo_from_url("https://gitlab.com/a/b"), None);
        assert_eq!(github_repo_from_url("https://github.com/o/"), None);
    }
}
