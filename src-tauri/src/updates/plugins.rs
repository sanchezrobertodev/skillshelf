//! Marketplace plugins: compare what's installed with the marketplace catalog
//! (refreshed first with `claude plugin marketplace update`).

use std::path::Path;
use std::time::Duration;

use serde_json::Value;

use super::{Outcome, looks_like_sha, semver_newer, short};
use crate::model::{CheckInfo, Status};
use crate::scan::read_json;
use crate::{paths, proc};

const GIT_TIMEOUT: Duration = Duration::from_secs(30);

pub async fn refresh_marketplaces() -> Result<(), String> {
    let out = proc::run(
        "claude",
        &["plugin", "marketplace", "update"],
        None,
        Duration::from_secs(180),
    )
    .await?;
    if out.success() {
        Ok(())
    } else {
        Err(last_line(&out.stderr)
            .or_else(|| last_line(&out.stdout))
            .unwrap_or_else(|| "unknown error".into()))
    }
}

fn last_line(s: &str) -> Option<String> {
    s.lines()
        .rev()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .map(str::to_string)
}

pub async fn check(info: &CheckInfo) -> Outcome {
    let CheckInfo::Plugin {
        marketplace,
        name,
        installed_version,
        git_sha,
        install_path,
        ..
    } = info
    else {
        return Outcome::unknown("Not a marketplace plugin");
    };
    let known = read_json(&paths::known_marketplaces_file()).unwrap_or(Value::Null);
    let Some(location) = known
        .pointer(&format!("/{}/installLocation", escape_pointer(marketplace)))
        .and_then(Value::as_str)
    else {
        return Outcome::unknown(format!("Marketplace `{marketplace}` is not configured"));
    };
    let location = Path::new(location);
    let Some(catalog) = read_json(&location.join(".claude-plugin").join("marketplace.json")) else {
        return Outcome::unknown(format!("Marketplace `{marketplace}` has no catalog on disk"));
    };
    let Some(entry) = catalog.get("plugins").and_then(Value::as_array).and_then(|list| {
        list.iter()
            .find(|p| p.get("name").and_then(Value::as_str) == Some(name.as_str()))
    }) else {
        return Outcome::unknown(format!("`{name}` is no longer listed in `{marketplace}`"));
    };
    decide(
        location,
        entry,
        installed_version.as_deref(),
        git_sha.as_deref(),
        install_path.as_deref(),
    )
    .await
}

fn escape_pointer(s: &str) -> String {
    s.replace('~', "~0").replace('/', "~1")
}

pub async fn decide(
    location: &Path,
    entry: &Value,
    installed: Option<&str>,
    git_sha: Option<&str>,
    install_path: Option<&Path>,
) -> Outcome {
    let entry_version = entry.get("version").and_then(Value::as_str).map(str::to_string);

    match entry.get("source") {
        Some(Value::String(rel)) => {
            let rel = rel.trim_start_matches("./").trim_end_matches('/');
            let plugin_dir = if rel.is_empty() {
                location.to_path_buf()
            } else {
                location.join(rel)
            };
            let latest_version = entry_version.or_else(|| {
                read_json(&plugin_dir.join(".claude-plugin").join("plugin.json"))
                    .and_then(|m| m.get("version").and_then(Value::as_str).map(str::to_string))
            });

            if let (Some(i), Some(l)) = (installed, latest_version.as_deref())
                && let Some(newer) = semver_newer(i, l)
            {
                return by_flag(newer, l.to_string());
            }
            let semver_latest = latest_version.clone().filter(|v| !looks_like_sha(v));
            let mut git_error = None;
            if let Some(sha) = git_sha {
                match path_changed_since(location, sha, rel).await {
                    Ok(true) => {
                        let head = git_head(location).await.unwrap_or_default();
                        let latest = semver_latest.unwrap_or_else(|| short(&head));
                        return Outcome::new(
                            Status::UpdateAvailable,
                            Some(latest),
                            Some("Plugin files changed in the marketplace".into()),
                        );
                    }
                    Ok(false) => return Outcome::new(Status::UpToDate, installed.map(str::to_string), None),
                    Err(e) => git_error = Some(e),
                }
            }
            // Marketplaces downloaded as archives have no git history: compare the files instead.
            if let Some(dir) = install_path.filter(|d| d.is_dir())
                && plugin_dir.is_dir()
            {
                return if folders_differ(dir, &plugin_dir) {
                    Outcome::new(
                        Status::UpdateAvailable,
                        Some(semver_latest.unwrap_or_else(|| "newer".into())),
                        Some("Plugin files changed in the marketplace".into()),
                    )
                } else {
                    Outcome::new(Status::UpToDate, installed.map(str::to_string), None)
                };
            }
            match (installed, latest_version) {
                (Some(i), Some(l)) => by_flag(i != l, l),
                _ => Outcome::unknown(
                    git_error.unwrap_or_else(|| "The marketplace doesn't publish a version for this plugin".into()),
                ),
            }
        }
        Some(Value::Object(src)) => {
            let kind = src.get("source").and_then(Value::as_str).unwrap_or_default();
            if kind == "npm" {
                let Some(package) = src.get("package").and_then(Value::as_str) else {
                    return Outcome::unknown("npm source without a package name");
                };
                return match npm_latest(package).await {
                    Ok(latest) => match installed.and_then(|i| semver_newer(i, &latest)) {
                        Some(newer) => by_flag(newer, latest),
                        None => Outcome::new(
                            Status::Unknown,
                            Some(latest),
                            Some("Installed version isn't semver".into()),
                        ),
                    },
                    Err(e) => Outcome::error(e),
                };
            }

            if let (Some(i), Some(l)) = (installed, entry_version.as_deref())
                && let Some(newer) = semver_newer(i, l)
            {
                return by_flag(newer, l.to_string());
            }

            let pinned = src.get("sha").and_then(Value::as_str).map(str::to_string);
            let remote = match pinned {
                Some(sha) => Ok(sha),
                None => {
                    let url = match kind {
                        "github" => src
                            .get("repo")
                            .and_then(Value::as_str)
                            .map(|r| format!("https://github.com/{r}.git")),
                        _ => src.get("url").and_then(Value::as_str).map(str::to_string),
                    };
                    match url {
                        Some(url) => ls_remote(&url, src.get("ref").and_then(Value::as_str)).await,
                        None => Err("Source has no repository URL".to_string()),
                    }
                }
            };
            match (remote, git_sha) {
                (Ok(remote), Some(local)) => {
                    let same = remote.starts_with(local) || local.starts_with(&remote);
                    let latest = entry_version.unwrap_or_else(|| short(&remote));
                    by_flag(!same, latest)
                }
                (Ok(remote), None) => Outcome::new(
                    Status::Unknown,
                    Some(entry_version.unwrap_or_else(|| short(&remote))),
                    Some("Install commit unknown".into()),
                ),
                (Err(e), _) => Outcome::error(e),
            }
        }
        _ => Outcome::unknown("Catalog entry has no source"),
    }
}

/// Files Claude Code adds to an installed plugin folder that aren't part of the plugin.
const IGNORED: &[&str] = &[".in_use", ".orphaned_at", "node_modules", ".git", ".DS_Store"];

/// True when the two plugin folders don't hold the same files with the same contents.
pub fn folders_differ(a: &Path, b: &Path) -> bool {
    fn listing(root: &Path) -> Option<Vec<(String, u64)>> {
        let mut out = Vec::new();
        let mut stack = vec![root.to_path_buf()];
        while let Some(dir) = stack.pop() {
            for entry in std::fs::read_dir(&dir).ok()?.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                if IGNORED.contains(&name.as_str()) {
                    continue;
                }
                let path = entry.path();
                let meta = std::fs::metadata(&path).ok()?;
                if meta.is_dir() {
                    stack.push(path);
                } else {
                    let rel = path.strip_prefix(root).ok()?.to_string_lossy().replace('\\', "/");
                    out.push((rel, meta.len()));
                }
            }
        }
        out.sort();
        Some(out)
    }
    let (Some(la), Some(lb)) = (listing(a), listing(b)) else {
        return true;
    };
    if la != lb {
        return true;
    }
    la.iter()
        .any(|(rel, _)| std::fs::read(a.join(rel)).ok() != std::fs::read(b.join(rel)).ok())
}

fn by_flag(newer: bool, latest: String) -> Outcome {
    if newer {
        Outcome::new(Status::UpdateAvailable, Some(latest), None)
    } else {
        Outcome::new(Status::UpToDate, Some(latest), None)
    }
}

/// True when anything under `rel` changed between `sha` and HEAD of the marketplace clone.
pub async fn path_changed_since(repo: &Path, sha: &str, rel: &str) -> Result<bool, String> {
    let repo_s = repo.display().to_string();
    let commit = format!("{sha}^{{commit}}");
    let exists = proc::run("git", &["-C", &repo_s, "cat-file", "-e", &commit], None, GIT_TIMEOUT).await?;
    if !exists.success() {
        return Err("The installed commit isn't in the local marketplace copy".into());
    }
    let path = if rel.is_empty() { "." } else { rel };
    let out = proc::run(
        "git",
        &["-C", &repo_s, "diff", "--quiet", sha, "HEAD", "--", path],
        None,
        GIT_TIMEOUT,
    )
    .await?;
    match out.code {
        Some(0) => Ok(false),
        Some(1) => Ok(true),
        _ => Err(format!("git diff failed: {}", out.stderr.trim())),
    }
}

async fn git_head(repo: &Path) -> Result<String, String> {
    let out = proc::run(
        "git",
        &["-C", &repo.display().to_string(), "rev-parse", "HEAD"],
        None,
        GIT_TIMEOUT,
    )
    .await?;
    Ok(out.stdout.trim().to_string())
}

async fn ls_remote(url: &str, reference: Option<&str>) -> Result<String, String> {
    let r = reference.unwrap_or("HEAD");
    let out = proc::run("git", &["ls-remote", url, r], None, GIT_TIMEOUT).await?;
    if !out.success() {
        return Err(format!("git ls-remote failed: {}", out.stderr.trim()));
    }
    out.stdout
        .lines()
        .find_map(|l| l.split_whitespace().next())
        .map(str::to_string)
        .ok_or_else(|| format!("`{r}` not found in {url}"))
}

async fn npm_latest(package: &str) -> Result<String, String> {
    let out = proc::run("npm", &["view", package, "version"], None, Duration::from_secs(60)).await?;
    if !out.success() {
        return Err(format!("npm view failed: {}", out.stderr.trim()));
    }
    Ok(out.stdout.trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn git(dir: &Path, args: &[&str]) -> String {
        let out = std::process::Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    fn init_repo() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path();
        git(p, &["init", "-q"]);
        git(p, &["config", "user.email", "t@example.com"]);
        git(p, &["config", "user.name", "t"]);
        git(p, &["config", "commit.gpgsign", "false"]);
        std::fs::create_dir_all(p.join("plugins/a")).unwrap();
        std::fs::create_dir_all(p.join("plugins/b")).unwrap();
        std::fs::write(p.join("plugins/a/x.md"), "1").unwrap();
        std::fs::write(p.join("plugins/b/y.md"), "1").unwrap();
        git(p, &["add", "."]);
        git(p, &["commit", "-qm", "one"]);
        dir
    }

    #[tokio::test]
    async fn sha_versioned_plugin_detects_changes_only_in_its_folder() {
        let repo = init_repo();
        let p = repo.path();
        let first = git(p, &["rev-parse", "HEAD"]);
        std::fs::write(p.join("plugins/b/y.md"), "2").unwrap();
        git(p, &["commit", "-qam", "touch b"]);

        let entry = json!({"name": "a", "source": "./plugins/a"});
        let installed = short(&first);
        let o = decide(p, &entry, Some(&installed), Some(&first), None).await;
        assert_eq!(o.status, Status::UpToDate);

        std::fs::write(p.join("plugins/a/x.md"), "2").unwrap();
        git(p, &["commit", "-qam", "touch a"]);
        let o = decide(p, &entry, Some(&installed), Some(&first), None).await;
        assert_eq!(o.status, Status::UpdateAvailable);
        assert_eq!(o.latest, Some(short(&git(p, &["rev-parse", "HEAD"]))));
    }

    #[tokio::test]
    async fn semver_entry_wins() {
        let repo = init_repo();
        let entry = json!({"name": "a", "version": "2.14.0", "source": "./"});
        let o = decide(repo.path(), &entry, Some("2.13.0"), None, None).await;
        assert_eq!(o.status, Status::UpdateAvailable);
        assert_eq!(o.latest.as_deref(), Some("2.14.0"));
        let o = decide(repo.path(), &entry, Some("2.14.0"), None, None).await;
        assert_eq!(o.status, Status::UpToDate);
    }

    #[tokio::test]
    async fn pinned_external_sha() {
        let repo = init_repo();
        let entry = json!({"name": "x", "source": {"source": "git-subdir", "url": "https://example.com/r.git", "path": "p", "sha": "faf5305385de8afed9468904e8639be737aff39e"}});
        let o = decide(
            repo.path(),
            &entry,
            Some("1.5.4"),
            Some("aaaa305385de8afed9468904e8639be737aff39e"),
            None,
        )
        .await;
        assert_eq!(o.status, Status::UpdateAvailable);
        let o = decide(
            repo.path(),
            &entry,
            Some("1.5.4"),
            Some("faf5305385de8afed9468904e8639be737aff39e"),
            None,
        )
        .await;
        assert_eq!(o.status, Status::UpToDate);
    }

    #[tokio::test]
    async fn archive_marketplace_compares_files() {
        let mkt = tempfile::tempdir().unwrap();
        let installed = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(mkt.path().join("plugins/a")).unwrap();
        std::fs::write(mkt.path().join("plugins/a/x.md"), "1").unwrap();
        std::fs::write(installed.path().join("x.md"), "1").unwrap();
        std::fs::write(installed.path().join(".in_use"), "").unwrap();
        let entry = json!({"name": "a", "source": "./plugins/a"});
        let sha = "ea10b213686c90bb1984b2016937310e05336cf3";
        let o = decide(
            mkt.path(),
            &entry,
            Some("ea10b213686c"),
            Some(sha),
            Some(installed.path()),
        )
        .await;
        assert_eq!(o.status, Status::UpToDate);
        std::fs::write(mkt.path().join("plugins/a/x.md"), "2").unwrap();
        let o = decide(
            mkt.path(),
            &entry,
            Some("ea10b213686c"),
            Some(sha),
            Some(installed.path()),
        )
        .await;
        assert_eq!(o.status, Status::UpdateAvailable);
    }
}
