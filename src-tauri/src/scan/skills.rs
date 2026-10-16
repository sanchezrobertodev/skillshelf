//! Skills in ~/.claude/skills (tracked by the `skills` CLI lockfile or not) and
//! in <project>/.claude/skills for each project folder in settings.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::Deserialize;
use serde_json::Value;

use super::{github_url, read_front_matter, read_json};
use crate::model::{CheckInfo, Item, Kind, Source};
use crate::paths;
use crate::settings::Settings;

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LockEntry {
    pub source: Option<String>,
    pub source_type: Option<String>,
    pub source_url: Option<String>,
    pub skill_path: Option<String>,
    pub skill_folder_hash: Option<String>,
    pub plugin_name: Option<String>,
    pub installed_at: Option<String>,
    pub updated_at: Option<String>,
}

pub fn read_lock(path: &Path) -> HashMap<String, LockEntry> {
    read_json(path)
        .and_then(|v| v.get("skills").cloned())
        .and_then(|s| serde_json::from_value(s).ok())
        .unwrap_or_default()
}

pub fn scan(settings: &Settings, warnings: &mut Vec<String>) -> Vec<Item> {
    let lock = read_lock(&paths::skill_lock_file());
    let mut items = Vec::new();

    let user_dir = paths::user_skills_dir();
    for dir in skill_dirs(&user_dir) {
        items.push(user_skill(&dir, &lock));
    }

    for project in &settings.projects {
        let root = PathBuf::from(project);
        if !root.is_dir() {
            warnings.push(format!("Project folder not found: {project}"));
            continue;
        }
        for dir in skill_dirs(&root.join(".claude").join("skills")) {
            items.push(project_skill(&dir, &root));
        }
    }
    items
}

/// Folders that contain a SKILL.md (following symlinks/junctions).
fn skill_dirs(root: &Path) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = std::fs::read_dir(root)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.join("SKILL.md").is_file())
        .collect();
    v.sort();
    v
}

fn dir_name(dir: &Path) -> String {
    dir.file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn base_item(dir: &Path, id: String, source: Source) -> Item {
    let folder = dir_name(dir);
    let fm = read_front_matter(&dir.join("SKILL.md"));
    let mut item = Item::new(
        id,
        Kind::Skill,
        source,
        fm.name.clone().unwrap_or_else(|| folder.clone()),
    );
    item.description = fm.description;
    item.version = fm.version;
    item.path = Some(dir.display().to_string());
    if fm.name.is_some_and(|n| n != folder) {
        item.meta.insert("Folder".into(), folder);
    }
    if std::fs::symlink_metadata(dir).is_ok_and(|m| m.file_type().is_symlink())
        && let Ok(target) = std::fs::read_link(dir)
    {
        item.meta.insert("Links to".into(), target.display().to_string());
    }
    if let Some(release) = read_json(&dir.join("skill-release.json")) {
        if item.version.is_none() {
            item.version = release.get("version").and_then(Value::as_str).map(str::to_string);
        }
        if let Some(channel) = release.get("channel").and_then(Value::as_str) {
            item.meta.insert("Release channel".into(), channel.to_string());
        }
        if let Some(repo) = release.pointer("/source/repository").and_then(Value::as_str) {
            item.repo_url = Some(repo.trim_end_matches(".git").to_string());
        }
        if let Some(url) = release.get("updateManifestUrl").and_then(Value::as_str) {
            item.check = CheckInfo::ReleaseManifest {
                url: url.to_string(),
                version: release.get("version").and_then(Value::as_str).map(str::to_string),
            };
        }
    }
    item
}

fn user_skill(dir: &Path, lock: &HashMap<String, LockEntry>) -> Item {
    let folder = dir_name(dir);
    let Some(entry) = lock.get(&folder) else {
        let mut item = base_item(dir, format!("skill:{folder}"), Source::Local);
        item.scope = Some("global".into());
        return item;
    };

    let mut item = base_item(dir, format!("skill:{folder}"), Source::SkillsCli);
    item.scope = Some("global".into());
    item.installed_at = entry.installed_at.clone();
    item.updated_at = entry.updated_at.clone();
    item.origin = entry.source.clone();
    let repo = (entry.source_type.as_deref() == Some("github"))
        .then(|| entry.source.clone())
        .flatten();
    if let Some(r) = &repo {
        item.repo_url = Some(github_url(r));
    } else if let Some(url) = &entry.source_url {
        item.repo_url = Some(url.trim_end_matches(".git").to_string());
    }
    if let Some(p) = &entry.plugin_name {
        item.meta.insert("Collection".into(), p.clone());
    }
    if let Some(p) = &entry.skill_path {
        item.meta.insert("Skill path".into(), p.clone());
    }
    if let Some(h) = &entry.skill_folder_hash {
        item.meta.insert("Folder hash".into(), h.clone());
        if item.version.is_none() {
            item.version = Some(format!("#{}", &h[..h.len().min(7)]));
        }
    }
    item.check = CheckInfo::SkillsCli {
        name: folder,
        repo,
        skill_path: entry.skill_path.clone().unwrap_or_else(|| "SKILL.md".into()),
        folder_hash: entry.skill_folder_hash.clone(),
    };
    item
}

fn project_skill(dir: &Path, project: &Path) -> Item {
    let folder = dir_name(dir);
    let mut item = base_item(dir, format!("project:{}:{folder}", project.display()), Source::Project);
    item.scope = Some("project".into());
    item.origin = Some(dir_name(project));
    item.meta.insert("Project".into(), project.display().to_string());
    item
}

#[cfg(test)]
mod tests {
    use super::*;

    const LOCK: &str = r#"{"version":3,"skills":{"hyperframes":{"source":"heygen-com/hyperframes","sourceType":"github",
        "sourceUrl":"https://github.com/heygen-com/hyperframes.git","skillPath":"skills/hyperframes/SKILL.md",
        "skillFolderHash":"3b627ccfa4a6278ffc096b0dae50988ecb7fcea1","pluginName":"core-skills",
        "installedAt":"2026-08-11T04:49:38.038Z","updatedAt":"2026-10-12T01:03:39.096Z"}},"dismissed":{}}"#;

    #[test]
    fn classifies_tracked_and_local_skills() {
        let tmp = tempfile::tempdir().unwrap();
        let lock_path = tmp.path().join("lock.json");
        std::fs::write(&lock_path, LOCK).unwrap();
        let lock = read_lock(&lock_path);

        let skills = tmp.path().join("skills");
        for name in ["hyperframes", "mine"] {
            std::fs::create_dir_all(skills.join(name)).unwrap();
            std::fs::write(
                skills.join(name).join("SKILL.md"),
                format!("---\nname: {name}\ndescription: d\n---\n"),
            )
            .unwrap();
        }
        std::fs::create_dir_all(skills.join("not-a-skill")).unwrap();

        let dirs = skill_dirs(&skills);
        assert_eq!(dirs.len(), 2);
        let tracked = user_skill(&dirs[0], &lock);
        assert_eq!(tracked.source, Source::SkillsCli);
        assert_eq!(tracked.version.as_deref(), Some("#3b627cc"));
        assert_eq!(
            tracked.repo_url.as_deref(),
            Some("https://github.com/heygen-com/hyperframes")
        );
        assert!(
            matches!(tracked.check, CheckInfo::SkillsCli { ref repo, .. } if repo.as_deref() == Some("heygen-com/hyperframes"))
        );
        let local = user_skill(&dirs[1], &lock);
        assert_eq!(local.source, Source::Local);
    }
}
