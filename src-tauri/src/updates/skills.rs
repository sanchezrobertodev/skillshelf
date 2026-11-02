//! Skills installed with the `skills` CLI: compare the git tree hash recorded in
//! the lockfile with the folder's current tree hash on GitHub (one request per repo).

use std::collections::HashMap;
use std::time::Duration;

use serde::Deserialize;
use serde_json::Value;

use super::changelog::{Entry, parse_github_commits};
use super::{Outcome, http, semver_newer, short};
use crate::model::{CheckInfo, Item, Status, Upstream};
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
        Github {
            client: http(),
            token: github_token().await,
        }
    }

    pub async fn get(&self, url: &str) -> Result<Value, String> {
        self.get_from(url).await.map(|(v, _)| v)
    }

    /// Also returns the URL GitHub answered from: a renamed repo redirects to `/repositories/<id>/…`.
    async fn get_from(&self, url: &str) -> Result<(Value, String), String> {
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
        let answered_from = res.url().to_string();
        let v = res
            .json()
            .await
            .map_err(|e| format!("Unexpected GitHub response: {e}"))?;
        Ok((v, answered_from))
    }

    /// The repo's file tree, and its new `owner/repo` when it was renamed or transferred.
    async fn tree(&self, repo: &str) -> Result<(Tree, Option<String>), String> {
        let (v, from) = self
            .get_from(&format!(
                "https://api.github.com/repos/{repo}/git/trees/HEAD?recursive=1"
            ))
            .await?;
        let tree = serde_json::from_value(v).map_err(|e| format!("Unexpected tree response: {e}"))?;
        let renamed = if from.starts_with("https://api.github.com/repositories/") {
            self.get(&format!("https://api.github.com/repos/{repo}"))
                .await
                .ok()
                .and_then(|r| r.get("full_name").and_then(Value::as_str).map(str::to_string))
                .filter(|new| !new.eq_ignore_ascii_case(repo))
        } else {
            None
        };
        Ok((tree, renamed))
    }

    /// The newest commit that touched `folder`; for a deleted folder, the commit that deleted it.
    async fn last_commit(&self, repo: &str, folder: &str) -> Option<Entry> {
        let url = reqwest::Url::parse_with_params(
            &format!("https://api.github.com/repos/{repo}/commits"),
            &[("path", folder), ("per_page", "1")],
        )
        .ok()?;
        parse_github_commits(&self.get(url.as_str()).await.ok()?)
            .into_iter()
            .next()
    }

    /// The tree hash of `folder` at a commit (HEAD when `at` is `None`). Also the fallback for huge
    /// repos whose recursive tree is truncated.
    pub async fn folder_sha(&self, repo: &str, folder: &str, at: Option<&str>) -> Result<Option<String>, String> {
        let (parent, name) = folder.rsplit_once('/').unwrap_or(("", folder));
        let at = at.map(|sha| format!("?ref={sha}")).unwrap_or_default();
        let v = self
            .get(&format!("https://api.github.com/repos/{repo}/contents/{parent}{at}"))
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

/// Item index, skill name, folder in the repo, recorded folder hash.
type Queued = (usize, String, String, Option<String>);

pub async fn check(items: &[Item]) -> (Vec<(usize, Outcome)>, Vec<String>) {
    let mut by_repo: HashMap<String, Vec<Queued>> = HashMap::new();
    let mut results = Vec::new();

    for (idx, item) in items.iter().enumerate() {
        if let CheckInfo::SkillsCli {
            name,
            repo,
            skill_path,
            folder_hash,
        } = &item.check
        {
            match repo {
                Some(r) => by_repo.entry(r.clone()).or_default().push((
                    idx,
                    name.clone(),
                    skill_folder(skill_path),
                    folder_hash.clone(),
                )),
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
        let (tree, renamed) = match tree {
            Ok(t) => t,
            Err(e) => {
                warnings.push(format!("{repo}: {e}"));
                results.extend(skills.into_iter().map(|(idx, ..)| (idx, Outcome::error(e.clone()))));
                continue;
            }
        };
        for (idx, name, folder, local) in skills {
            let remote = match locate(&tree, &folder, &name) {
                Located::At(sha) => sha,
                // A partial listing can't prove a folder moved or was deleted: ask for the folder itself.
                _ if tree.truncated => match gh.folder_sha(&repo, &folder, None).await {
                    Ok(Some(sha)) => sha,
                    Ok(None) => {
                        results.push((idx, compare_hash(local.as_deref(), None)));
                        continue;
                    }
                    Err(e) => {
                        results.push((idx, too_big_to_check(&e)));
                        continue;
                    }
                },
                Located::MovedTo(new) => {
                    results.push((idx, moved(renamed.as_deref().unwrap_or(&repo), &new)));
                    continue;
                }
                Located::Gone => {
                    results.push((idx, removed(&repo, gh.last_commit(&repo, &folder).await)));
                    continue;
                }
            };
            let outcome = match &renamed {
                Some(new_repo) => moved(new_repo, &folder),
                None => compare_hash(local.as_deref(), Some(&remote)),
            };
            results.push((idx, outcome));
        }
    }
    (results, warnings)
}

#[derive(Debug, PartialEq)]
enum Located {
    /// The folder is still there, with this tree hash.
    At(String),
    /// Gone from its path, but a folder with the skill's name and a SKILL.md is here.
    MovedTo(String),
    Gone,
}

fn locate(tree: &Tree, folder: &str, name: &str) -> Located {
    if folder.is_empty() {
        return Located::At(tree.sha.clone());
    }
    if let Some(e) = tree.tree.iter().find(|e| e.kind == "tree" && e.path == folder) {
        return Located::At(e.sha.clone());
    }
    let old_name = folder.rsplit('/').next().unwrap_or(folder);
    tree.tree
        .iter()
        .filter(|e| e.kind == "blob")
        .filter_map(|e| e.path.strip_suffix("/SKILL.md"))
        .find(|dir| {
            let last = dir.rsplit('/').next().unwrap_or(dir);
            last == old_name || last == name
        })
        .map_or(Located::Gone, |dir| Located::MovedTo(dir.to_string()))
}

fn moved(repo: &str, folder: &str) -> Outcome {
    let place = if folder.is_empty() {
        repo.to_string()
    } else {
        format!("{repo}/{folder}")
    };
    Outcome {
        detail: Some(format!("Moved upstream to {place}. Reinstall to keep getting updates.")),
        upstream: Some(Upstream {
            repo: repo.into(),
            folder: Some(folder.into()),
            commit: None,
        }),
        ..Outcome::new(Status::Moved, None, None)
    }
}

fn removed(repo: &str, commit: Option<Entry>) -> Outcome {
    let detail = match &commit {
        Some(c) => format!("Deleted upstream in {}: {}", short(&c.sha), c.message),
        None => "Deleted upstream; GitHub didn't say in which commit.".into(),
    };
    Outcome {
        detail: Some(detail),
        upstream: Some(Upstream {
            repo: repo.into(),
            folder: None,
            commit,
        }),
        ..Outcome::new(Status::Removed, None, None)
    }
}

/// The repo's file list was truncated and the per-folder lookup failed too: we don't know, so never say "removed".
fn too_big_to_check(err: &str) -> Outcome {
    Outcome::unknown(format!(
        "Repo too large for GitHub to list in one request, and the fallback lookup failed: {err}"
    ))
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
    let manifest: Value = match http().get(url).send().await {
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

    fn tree(entries: &[(&str, &str)]) -> Tree {
        Tree {
            sha: "root".into(),
            truncated: false,
            tree: entries
                .iter()
                .map(|(path, kind)| TreeEntry {
                    path: path.to_string(),
                    kind: kind.to_string(),
                    sha: format!("sha-{path}"),
                })
                .collect(),
        }
    }

    #[test]
    fn finds_moved_and_deleted_skill_folders() {
        let t = tree(&[
            ("skills", "tree"),
            ("skills/a", "tree"),
            ("skills/a/SKILL.md", "blob"),
            ("plugins/core/skills/b", "tree"),
            ("plugins/core/skills/b/SKILL.md", "blob"),
            ("docs/c", "tree"),
            ("docs/c/README.md", "blob"),
        ]);
        assert_eq!(locate(&t, "skills/a", "a"), Located::At("sha-skills/a".into()));
        assert_eq!(locate(&t, "", "x"), Located::At("root".into()));
        assert_eq!(
            locate(&t, "skills/b", "b"),
            Located::MovedTo("plugins/core/skills/b".into())
        );
        assert_eq!(
            locate(&t, "skills/c", "c"),
            Located::Gone,
            "a folder without SKILL.md isn't the skill"
        );

        let o = moved("owner/new", "plugins/core/skills/b");
        assert_eq!(o.status, Status::Moved);
        assert_eq!(o.upstream.unwrap().repo, "owner/new");
        let gone = Entry {
            sha: "0123456789abcdef".into(),
            date: None,
            message: "Remove old skills".into(),
            url: None,
        };
        let o = removed("owner/repo", Some(gone));
        assert_eq!(o.status, Status::Removed);
        assert_eq!(
            o.detail.as_deref(),
            Some("Deleted upstream in 0123456789ab: Remove old skills")
        );
    }

    #[test]
    fn failed_fallback_is_not_reported_as_removed() {
        let o = too_big_to_check("GitHub returned 500");
        assert_eq!(o.status, Status::Unknown);
        assert!(o.detail.unwrap().starts_with("Repo too large"));
    }
}
