//! Updating a copy that runs from its own git clone: pull, reinstall, rebuild, reopen. Installed
//! copies keep the release updater. A clone with work in it (another branch, local commits,
//! uncommitted changes) is never touched.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;

use crate::proc;

const GIT: Duration = Duration::from_secs(120);
const INSTALL: Duration = Duration::from_secs(10 * 60);
// shortcut: a cold release build can outlast the usual 10-minute limit; 30 minutes covers a first build on a slow machine.
const BUILD: Duration = Duration::from_secs(30 * 60);
/// New commits listed as "what's new".
const SHOWN: usize = 20;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CloneStatus {
    pub dir: String,
    pub branch: String,
    pub default_branch: String,
    /// Commits on origin's default branch that the clone doesn't have.
    pub behind: u32,
    /// Newest first, `<short sha> <subject>`.
    pub commits: Vec<String>,
    /// Why updating is refused.
    pub blocked: Option<String>,
}

/// The clone this binary was built from, when it runs from that clone's `src-tauri/target`.
/// Release builds made elsewhere (CI) point at a folder that doesn't exist here, so they never match.
pub fn clone_dir() -> Option<PathBuf> {
    let src_tauri = Path::new(env!("CARGO_MANIFEST_DIR"));
    let target = src_tauri.join("target").canonicalize().ok()?;
    let exe = std::env::current_exe().ok()?.canonicalize().ok()?;
    let root = src_tauri.parent()?;
    (exe.starts_with(&target) && root.join(".git").exists()).then(|| root.to_path_buf())
}

/// Removes the binary a previous update moved aside.
pub fn remove_old_binary() {
    if let Ok(exe) = std::env::current_exe() {
        let _ = std::fs::remove_file(aside(&exe));
    }
}

fn aside(exe: &Path) -> PathBuf {
    let mut name = exe.file_name().unwrap_or_default().to_os_string();
    name.push(".old");
    exe.with_file_name(name)
}

async fn git(dir: &Path, args: &[&str]) -> Result<String, String> {
    let out = proc::run("git", args, Some(dir), GIT).await?;
    if out.success() {
        Ok(out.stdout.trim().to_string())
    } else {
        Err(format!("git {} failed: {}", args.join(" "), out.stderr.trim()))
    }
}

/// Fetches origin and compares the clone with its default branch.
pub async fn status(dir: &Path) -> Result<CloneStatus, String> {
    git(dir, &["fetch", "--quiet", "origin"]).await?;
    let head = git(dir, &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])
        .await
        .map_err(|_| {
            "Couldn't tell origin's default branch. Run `git remote set-head origin --auto` in the clone.".to_string()
        })?;
    let default_branch = head.strip_prefix("origin/").unwrap_or(&head).to_string();
    let upstream = format!("origin/{default_branch}");
    let branch = git(dir, &["rev-parse", "--abbrev-ref", "HEAD"]).await?;
    let counts = git(
        dir,
        &["rev-list", "--left-right", "--count", &format!("HEAD...{upstream}")],
    )
    .await?;
    let (ahead, behind) =
        parse_counts(&counts).ok_or_else(|| format!("Unexpected output from git rev-list: {counts}"))?;
    let dirty = !git(dir, &["status", "--porcelain", "--untracked-files=no"])
        .await?
        .is_empty();
    let commits = if behind > 0 {
        let range = format!("HEAD..{upstream}");
        let limit = format!("-{SHOWN}");
        git(dir, &["log", "--format=%h %s", &limit, &range])
            .await?
            .lines()
            .map(str::to_string)
            .collect()
    } else {
        Vec::new()
    };
    Ok(CloneStatus {
        dir: dir.display().to_string(),
        blocked: blocked(&branch, &default_branch, ahead, dirty),
        branch,
        default_branch,
        behind,
        commits,
    })
}

/// `git rev-list --left-right --count` prints "<ahead>\t<behind>".
fn parse_counts(s: &str) -> Option<(u32, u32)> {
    let mut n = s.split_whitespace().map(|x| x.parse().ok());
    Some((n.next()??, n.next()??))
}

fn blocked(branch: &str, default: &str, ahead: u32, dirty: bool) -> Option<String> {
    if branch == "HEAD" {
        return Some(format!(
            "The clone isn't on a branch (detached HEAD). Check out {default} to update."
        ));
    }
    if branch != default {
        return Some(format!(
            "The clone is on branch {branch}, not {default}. Switch to {default} to update."
        ));
    }
    if ahead > 0 {
        let s = if ahead == 1 { "" } else { "s" };
        return Some(format!(
            "Your {default} has {ahead} commit{s} that origin doesn't, so it has diverged. Push or reset them first."
        ));
    }
    dirty.then(|| "The clone has uncommitted changes. Commit or stash them first.".to_string())
}

async fn step(
    dir: &Path,
    program: &str,
    args: &[&str],
    timeout: Duration,
    on_line: &mut impl FnMut(&str),
) -> Result<(), String> {
    on_line(&format!("$ {program} {}", args.join(" ")));
    let owned: Vec<String> = args.iter().map(|a| a.to_string()).collect();
    let out = proc::run_streaming(program, &owned, Some(dir), timeout, |l| on_line(l)).await?;
    if out.success() {
        Ok(())
    } else {
        Err(format!(
            "`{program} {}` failed (exit code {}). The output above says why.",
            args.join(" "),
            out.code.map_or("none".into(), |c| c.to_string())
        ))
    }
}

/// Pulls, reinstalls and rebuilds, then returns the new binary to start. When the build would
/// overwrite the running binary, that binary is moved aside first: Windows can rename a running
/// exe but not replace it.
pub async fn update(dir: &Path, mut on_line: impl FnMut(&str)) -> Result<PathBuf, String> {
    let s = status(dir).await?;
    if let Some(why) = s.blocked {
        return Err(why);
    }
    if s.behind == 0 {
        return Err("Already up to date.".into());
    }
    step(dir, "git", &["pull", "--ff-only"], GIT, &mut on_line).await?;
    step(dir, "npm", &["ci", "--no-audit", "--no-fund"], INSTALL, &mut on_line).await?;

    let built = dir
        .join("src-tauri")
        .join("target")
        .join("release")
        .join(format!("skillshelf{}", std::env::consts::EXE_SUFFIX));
    let running = std::env::current_exe().and_then(|e| e.canonicalize()).ok();
    let moved = built.exists() && built.canonicalize().ok() == running;
    if moved {
        std::fs::rename(&built, aside(&built)).map_err(|e| format!("Couldn't move the running app aside: {e}"))?;
    }
    let result = step(
        dir,
        "npm",
        &["run", "tauri", "build", "--", "--no-bundle"],
        BUILD,
        &mut on_line,
    )
    .await;
    if result.is_err() && moved && !built.exists() {
        let _ = std::fs::rename(aside(&built), &built);
    }
    result.map(|()| built)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_clones_with_work_in_them() {
        assert_eq!(blocked("master", "master", 0, false), None);
        assert!(
            blocked("feature/x", "master", 0, false)
                .unwrap()
                .contains("branch feature/x")
        );
        assert!(blocked("HEAD", "master", 0, false).unwrap().contains("detached"));
        assert!(blocked("master", "master", 2, false).unwrap().contains("2 commits"));
        assert!(blocked("master", "master", 0, true).unwrap().contains("uncommitted"));
        assert_eq!(parse_counts("1\t5"), Some((1, 5)));
        assert_eq!(parse_counts("nope"), None);
        assert_eq!(
            aside(Path::new("/x/skillshelf.exe")),
            Path::new("/x/skillshelf.exe.old")
        );
    }

    fn sh(dir: &Path, args: &[&str]) {
        let ok = std::process::Command::new("git")
            .args([
                "-c",
                "user.name=t",
                "-c",
                "user.email=t@t",
                "-c",
                "commit.gpgsign=false",
            ])
            .args(args)
            .current_dir(dir)
            .output()
            .expect("git runs")
            .status
            .success();
        assert!(ok, "git {args:?}");
    }

    /// A bare origin, a clone of it, and a second clone that pushes new commits.
    #[tokio::test]
    async fn compares_a_clone_with_its_origin() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        sh(root, &["init", "--bare", "-b", "main", "origin.git"]);
        sh(root, &["clone", "-q", "origin.git", "other"]);
        let other = root.join("other");
        std::fs::write(other.join("a.txt"), "1").unwrap();
        sh(&other, &["add", "."]);
        sh(&other, &["commit", "-qm", "first"]);
        sh(&other, &["push", "-q", "origin", "HEAD:main"]);
        sh(root, &["clone", "-q", "origin.git", "mine"]);
        let mine = root.join("mine");

        let s = status(&mine).await.unwrap();
        assert_eq!(
            (s.default_branch.as_str(), s.behind, s.blocked.clone()),
            ("main", 0, None)
        );

        std::fs::write(other.join("a.txt"), "2").unwrap();
        sh(&other, &["commit", "-qam", "second"]);
        sh(&other, &["push", "-q", "origin", "HEAD:main"]);
        let s = status(&mine).await.unwrap();
        assert_eq!(s.behind, 1);
        assert!(s.commits[0].ends_with(" second"), "{:?}", s.commits);
        assert_eq!(s.blocked, None);

        std::fs::write(mine.join("a.txt"), "local edit").unwrap();
        assert!(status(&mine).await.unwrap().blocked.unwrap().contains("uncommitted"));
        sh(&mine, &["commit", "-qam", "local"]);
        assert!(status(&mine).await.unwrap().blocked.unwrap().contains("diverged"));
        sh(&mine, &["checkout", "-qb", "feature"]);
        assert!(status(&mine).await.unwrap().blocked.unwrap().contains("branch feature"));
    }
}
