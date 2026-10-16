//! Skills installed with the `skills` CLI: compare the git tree hash recorded in
//! the lockfile with the folder's current tree hash on GitHub (one request per repo).

use std::collections::HashMap;
use std::time::Duration;

use serde::Deserialize;
use serde_json::Value;

use super::{Outcome, semver_newer};
use crate::model::{CheckInfo, Item, Status};
use crate::proc;

#[derive(Debug, Deserialize)]
struct Tree {
    sha: String,
    #[serde(default)]
    tree: Vec<TreeEntry>,
    #[serde(default)]
    truncated: bool,
}

#[derive(Debug, Deserialize)]
struct TreeEntry {
    path: String,
    #[serde(rename = "type")]
    kind: String,
    sha: String,
}

pub struct Github {
    client: reqwest::Client,
    token: Option<String>,
}

impl Github {
    pub async fn new() -> Self {
        let client = reqwest::Client::builder()
            .user_agent(concat!("skillshelf/", env!("CARGO_PKG_VERSION")))
            .timeout(Duration::from_secs(20))
            .build()
            .expect("http client");
        Github {
            client,
            token: github_token().await,
        }
    }

    async fn get(&self, url: &str) -> Result<Value, String> {
        let mut req = self.client.get(url).header("Accept", "application/vnd.github+json");
        if let Some(t) = &self.token {
            req = req.bearer_auth(t);
        }
        let res = req.send().await.map_err(|e| format!("GitHub request failed: {e}"))?;
        let status = res.status();
        if status.as_u16() == 403 || status.as_u16() == 429 {
            let remaining = res
                .headers()
                .get("x-ratelimit-remaining")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("");
            if remaining == "0" || status.as_u16() == 429 {
                return Err("GitHub rate limit reached. Sign in with `gh auth login` or set GITHUB_TOKEN.".into());
            }
        }
        if !status.is_success() {
            return Err(format!("GitHub returned {status} for {url}"));
        }
        res.json().await.map_err(|e| format!("Unexpected GitHub response: {e}"))
    }

    async fn tree(&self, repo: &str) -> Result<Tree, String> {
        let v = self
            .get(&format!(
                "https://api.github.com/repos/{repo}/git/trees/HEAD?recursive=1"
            ))
            .await?;
        serde_json::from_value(v).map_err(|e| format!("Unexpected tree response: {e}"))
    }

    /// Fallback for huge repos whose recursive tree is truncated.
    async fn folder_sha(&self, repo: &str, folder: &str) -> Result<Option<String>, String> {
        let (parent, name) = folder.rsplit_once('/').unwrap_or(("", folder));
        let v = self
            .get(&format!("https://api.github.com/repos/{repo}/contents/{parent}"))
            .await?;
        Ok(v.as_array().and_then(|list| {
            list.iter()
                .find(|e| {
                    e.get("name").and_then(Value::as_str) == Some(name)
                        && e.get("type").and_then(Value::as_str) == Some("dir")
                })
                .and_then(|e| e.get("sha").and_then(Value::as_str))
                .map(str::to_string)
        }))
    }
}

async fn github_token() -> Option<String> {
    for var in ["GITHUB_TOKEN", "GH_TOKEN"] {
        if let Ok(t) = std::env::var(var)
            && !t.trim().is_empty()
        {
            return Some(t.trim().to_string());
        }
    }
    proc::resolve("gh")?;
    let out = proc::run("gh", &["auth", "token"], None, Duration::from_secs(5))
        .await
        .ok()?;
    let token = out.stdout.trim().to_string();
    (out.success() && !token.is_empty()).then_some(token)
}

/// Folder of a skill inside its repo: `skills/x/SKILL.md` → `skills/x`, `SKILL.md` → ``.
pub fn skill_folder(skill_path: &str) -> String {
    let p = skill_path.replace('\\', "/");
    match p.rsplit_once('/') {
        Some((dir, _)) => dir.to_string(),
        None => String::new(),
    }
}

pub async fn check(items: &[Item]) -> (Vec<(usize, Outcome)>, Vec<String>) {
    let mut by_repo: HashMap<String, Vec<(usize, String, Option<String>)>> = HashMap::new();
    let mut results = Vec::new();

    for (idx, item) in items.iter().enumerate() {
        if let CheckInfo::SkillsCli {
            repo,
            skill_path,
            folder_hash,
            ..
        } = &item.check
        {
            match repo {
                Some(r) => {
                    by_repo
                        .entry(r.clone())
                        .or_default()
                        .push((idx, skill_folder(skill_path), folder_hash.clone()))
                }
                None => results.push((idx, Outcome::unknown("Only GitHub sources can be checked"))),
            }
        }
    }
    if by_repo.is_empty() {
        return (results, Vec::new());
    }

    let gh = Github::new().await;
    let mut warnings = Vec::new();
    let fetched = futures::future::join_all(by_repo.into_iter().map(|(repo, skills)| {
        let gh = &gh;
        async move { (gh.tree(&repo).await, repo, skills) }
    }))
    .await;

    for (tree, repo, skills) in fetched {
        let tree = match tree {
            Ok(t) => t,
            Err(e) => {
                warnings.push(format!("{repo}: {e}"));
                results.extend(skills.into_iter().map(|(idx, ..)| (idx, Outcome::error(e.clone()))));
                continue;
            }
        };
        let dirs: HashMap<&str, &str> = tree
            .tree
            .iter()
            .filter(|e| e.kind == "tree")
            .map(|e| (e.path.as_str(), e.sha.as_str()))
            .collect();

        for (idx, folder, local) in skills {
            let remote = if folder.is_empty() {
                Some(tree.sha.clone())
            } else if let Some(sha) = dirs.get(folder.as_str()) {
                Some(sha.to_string())
            } else if tree.truncated {
                gh.folder_sha(&repo, &folder).await.ok().flatten()
            } else {
                None
            };
            results.push((idx, compare_hash(local.as_deref(), remote.as_deref())));
        }
    }
    (results, warnings)
}

pub fn compare_hash(local: Option<&str>, remote: Option<&str>) -> Outcome {
    match (local, remote) {
        (_, None) => Outcome::new(
            Status::Unknown,
            None,
            Some("The skill folder no longer exists upstream".into()),
        ),
        (None, Some(r)) => Outcome::new(
            Status::Unknown,
            Some(format!("#{}", &r[..7.min(r.len())])),
            Some("No recorded hash".into()),
        ),
        (Some(l), Some(r)) if l == r => {
            Outcome::new(Status::UpToDate, Some(format!("#{}", &r[..7.min(r.len())])), None)
        }
        (Some(_), Some(r)) => Outcome::new(
            Status::UpdateAvailable,
            Some(format!("#{}", &r[..7.min(r.len())])),
            Some("Skill files changed upstream".into()),
        ),
    }
}

/// Skills that publish their own update manifest (skill-release.json → updateManifestUrl).
pub async fn check_manifest(url: &str, installed: Option<&str>) -> Outcome {
    let client = reqwest::Client::builder()
        .user_agent(concat!("skillshelf/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(20))
        .build()
        .expect("http client");
    let manifest: Value = match client.get(url).send().await {
        Ok(r) if r.status().is_success() => match r.json().await {
            Ok(v) => v,
            Err(e) => return Outcome::error(format!("Bad update manifest: {e}")),
        },
        Ok(r) => return Outcome::error(format!("Update manifest returned {}", r.status())),
        Err(e) => return Outcome::error(format!("Could not fetch update manifest: {e}")),
    };
    let Some(latest) = manifest.get("version").and_then(Value::as_str).map(str::to_string) else {
        return Outcome::unknown("Update manifest has no version");
    };
    match installed.and_then(|i| semver_newer(i, &latest)) {
        Some(true) => Outcome::new(
            Status::UpdateAvailable,
            Some(latest),
            manifest.get("summary").and_then(Value::as_str).map(str::to_string),
        ),
        Some(false) => Outcome::new(Status::UpToDate, Some(latest), None),
        None => Outcome::new(
            Status::Unknown,
            Some(latest),
            Some("Installed version isn't semver".into()),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folder_of_skill_path() {
        assert_eq!(
            skill_folder("skills/game-engines/unity/x/SKILL.md"),
            "skills/game-engines/unity/x"
        );
        assert_eq!(skill_folder("SKILL.md"), "");
    }

    #[test]
    fn hash_comparison() {
        assert_eq!(
            compare_hash(Some("abc1234567"), Some("abc1234567")).status,
            Status::UpToDate
        );
        let o = compare_hash(Some("abc1234567"), Some("def7654321"));
        assert_eq!(o.status, Status::UpdateAvailable);
        assert_eq!(o.latest.as_deref(), Some("#def7654"));
        assert_eq!(compare_hash(Some("a"), None).status, Status::Unknown);
    }
}
