//! "What changed" between the installed and the latest version of an item.
//! Fetched on demand when the user opens an item, never during the bulk update check.

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde::Serialize;
use serde_json::{Map, Value};

use super::plugins::{self, GIT_TIMEOUT};
use super::skills::{Github, skill_folder};
use crate::model::{CheckInfo, Item, Source};
use crate::proc;
use crate::scan::read_json;

/// Commits listed at most; the rest are behind `more_url`.
const MAX_ENTRIES: usize = 50;
const MAX_SECTIONS: usize = 20;
const MAX_SECTION_CHARS: usize = 6000;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub sha: String,
    pub date: Option<String>,
    /// First line of the commit message.
    pub message: String,
    pub url: Option<String>,
}

/// One release from a changelog file, e.g. `## [1.4.0] - 2026-09-01` and everything under it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Section {
    pub version: Option<String>,
    pub title: String,
    /// Markdown.
    pub body: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Changelog {
    /// What `entries` are, e.g. "Commits in the marketplace that touched this plugin".
    pub label: String,
    /// Newest first.
    pub entries: Vec<Entry>,
    /// Commits found, which can be more than `entries`.
    pub total: usize,
    pub sections: Vec<Section>,
    /// Where `sections` come from, e.g. "CHANGELOG.md".
    pub sections_label: Option<String>,
    /// A page with the full history.
    pub more_url: Option<String>,
    /// Why there's nothing to show, or a caveat about what is shown.
    pub note: Option<String>,
    /// A network request failed: not served from cache, so reopening the item tries again.
    pub retryable: bool,
}

impl Changelog {
    fn unavailable(why: impl Into<String>) -> Self {
        Changelog {
            note: Some(why.into()),
            ..Default::default()
        }
    }
}

type CacheKey = (String, Option<String>, Option<String>);

fn cache() -> &'static Mutex<HashMap<CacheKey, Changelog>> {
    static CACHE: OnceLock<Mutex<HashMap<CacheKey, Changelog>>> = OnceLock::new();
    CACHE.get_or_init(Default::default)
}

/// The changelog for one item. Results are kept until the item's version or latest version changes,
/// so reopening an item doesn't spend another GitHub request.
pub async fn for_item(item: &Item) -> Result<Changelog, String> {
    let key = (item.id.clone(), item.version.clone(), item.latest.clone());
    if let Some(hit) = cached(&key) {
        return Ok(hit);
    }
    let log = build(item).await?;
    remember(key, log.clone());
    Ok(log)
}

fn cached(key: &CacheKey) -> Option<Changelog> {
    cache().lock().unwrap().get(key).filter(|l| !l.retryable).cloned()
}

/// Every result is kept so `is_known_link` accepts its links; retryable ones are refetched by `cached`.
fn remember(key: CacheKey, log: Changelog) {
    cache().lock().unwrap().insert(key, log);
}

/// True when `url` came from a changelog already fetched for this item, so the UI can only open
/// links Skillshelf produced (commit pages, history pages, links inside release notes).
pub fn is_known_link(item_id: &str, url: &str) -> bool {
    cache().lock().unwrap().iter().any(|((id, ..), log)| {
        id == item_id
            && (log.more_url.as_deref() == Some(url)
                || log.entries.iter().any(|e| e.url.as_deref() == Some(url))
                || log.sections.iter().any(|s| s.body.contains(url)))
    })
}

async fn build(item: &Item) -> Result<Changelog, String> {
    match &item.check {
        _ if item.source == Source::Synced => Ok(Changelog::unavailable(
            "Your claude.ai organization updates this plugin and doesn't publish what changed.",
        )),
        CheckInfo::Plugin {
            marketplace,
            name,
            installed_version,
            git_sha,
            ..
        } => plugin(marketplace, name, installed_version.as_deref(), git_sha.as_deref()).await,
        CheckInfo::SkillsCli { repo, skill_path, .. } => {
            let since = item.updated_at.as_deref().or(item.installed_at.as_deref());
            skills_cli(repo.as_deref(), skill_path, since).await
        }
        CheckInfo::ReleaseManifest { url, version } => {
            release_manifest(url, version.as_deref(), item.latest.as_deref(), item.path.as_deref()).await
        }
        CheckInfo::None if matches!(item.source, Source::Local | Source::Project) => Ok(Changelog::unavailable(
            "No installer tracks this skill, so there's no upstream history to compare with.",
        )),
        CheckInfo::None => Ok(Changelog::unavailable("There's nothing to compare this item against.")),
    }
}

// ---------- marketplace plugins ----------

async fn plugin(
    marketplace: &str,
    name: &str,
    installed: Option<&str>,
    git_sha: Option<&str>,
) -> Result<Changelog, String> {
    let (location, entry) = match plugins::locate(marketplace, name) {
        Ok(found) => found,
        Err(e) => return Ok(Changelog::unavailable(e)),
    };
    match entry.get("source") {
        Some(Value::String(rel)) => {
            Ok(marketplace_changes(&location, plugins::relative_source(rel), installed, git_sha).await)
        }
        Some(Value::Object(src)) => external_changes(src, git_sha).await,
        _ => Ok(Changelog::unavailable(
            "The marketplace catalog doesn't say where this plugin comes from.",
        )),
    }
}

/// Plugins that live inside the marketplace repo: `git log` in the local marketplace clone, offline.
pub async fn marketplace_changes(
    location: &Path,
    rel: &str,
    installed: Option<&str>,
    git_sha: Option<&str>,
) -> Changelog {
    let mut log = Changelog {
        label: "Commits in the marketplace that touched this plugin".into(),
        ..Default::default()
    };
    let is_git = location.join(".git").exists();
    let web_repo = if is_git {
        remote_github_repo(location).await
    } else {
        None
    };

    let commits = match git_sha {
        _ if !is_git => {
            Err("This marketplace was downloaded without git history, so its commits can't be listed.".into())
        }
        None => Err("Claude Code didn't record which commit is installed, so the commits can't be listed.".into()),
        Some(sha) => match commits_since(location, sha, rel, web_repo.as_deref()).await {
            Ok(entries) => Ok((entries.len(), entries)),
            Err(local) => match (&web_repo, plugins::git_head(location).await) {
                (Some(repo), Ok(head)) if !head.is_empty() => {
                    github_path_commits(repo, sha, &head, rel).await.map_err(|e| {
                        log.retryable = true;
                        format!("{local} Asking GitHub instead failed: {e}")
                    })
                }
                _ => Err(local),
            },
        },
    };
    match commits {
        Ok((total, entries)) => {
            log.total = total;
            log.entries = entries.into_iter().take(MAX_ENTRIES).collect();
            if log.total == 0 {
                log.note = Some(
                    "No commits touched this plugin's folder. The update may only change its catalog entry.".into(),
                );
            }
            if let Some(repo) = &web_repo {
                let path = if rel.is_empty() {
                    String::new()
                } else {
                    format!("/{rel}")
                };
                log.more_url = Some(format!("https://github.com/{repo}/commits/HEAD{path}"));
            }
        }
        Err(e) => log.note = Some(e),
    }

    // CHANGELOG.md sections newer than the installed version.
    let plugin_dir = if rel.is_empty() {
        location.to_path_buf()
    } else {
        location.join(rel)
    };
    if let Some((file, text)) = read_changelog_file(&plugin_dir) {
        let mut after = installed.and_then(parse_version);
        if after.is_none()
            && let Some(sha) = git_sha
        {
            // Installed by commit: the newest release in the installed copy of the file is the baseline.
            let at = if rel.is_empty() {
                file.clone()
            } else {
                format!("{rel}/{file}")
            };
            let mut old = if is_git {
                git_show(location, sha, &at).await
            } else {
                None
            };
            if old.is_none()
                && let Some(repo) = &web_repo
            {
                old = raw_file(repo, sha, &at).await;
            }
            after = old.as_deref().and_then(newest_version);
        }
        if let Some(after) = after {
            log.sections = sections_between(&text, &after, None);
            if !log.sections.is_empty() {
                log.sections_label = Some(file);
            }
        }
    }
    log
}

/// Commits under `rel` between `base` (exclusive) and `head`, from GitHub: the compare API gives the
/// commits in the range, the commits API the ones that touched the folder. Two requests.
async fn github_path_commits(repo: &str, base: &str, head: &str, rel: &str) -> Result<(usize, Vec<Entry>), String> {
    let gh = Github::new().await;
    let cmp = gh
        .get(&format!("https://api.github.com/repos/{repo}/compare/{base}...{head}"))
        .await?;
    let mut in_range = parse_github_commits(cmp.get("commits").unwrap_or(&Value::Null));
    let range_total = cmp
        .get("total_commits")
        .and_then(Value::as_u64)
        .map_or(in_range.len(), |n| n as usize);
    if rel.is_empty() {
        in_range.reverse(); // compare lists oldest first
        return Ok((range_total, in_range));
    }
    let mut params = vec![("sha", head), ("path", rel), ("per_page", "100")];
    if let Some(since) = cmp
        .pointer("/merge_base_commit/commit/committer/date")
        .and_then(Value::as_str)
    {
        params.push(("since", since));
    }
    let url = reqwest::Url::parse_with_params(&format!("https://api.github.com/repos/{repo}/commits"), &params)
        .map_err(|e| format!("Bad repository name `{repo}`: {e}"))?;
    let touched = parse_github_commits(&gh.get(url.as_str()).await?);
    // Compare returns at most 250 commits; past that, trust the date filter alone.
    let complete = in_range.len() >= range_total;
    let shas: HashSet<&str> = in_range.iter().map(|e| e.sha.as_str()).collect();
    let entries: Vec<Entry> = touched
        .into_iter()
        .filter(|e| !e.sha.starts_with(base) && (!complete || shas.contains(e.sha.as_str())))
        .collect();
    Ok((entries.len(), entries))
}

/// A file at a commit, from raw.githubusercontent.com (not counted against the API rate limit).
async fn raw_file(repo: &str, sha: &str, path: &str) -> Option<String> {
    let res = http()
        .get(format!("https://raw.githubusercontent.com/{repo}/{sha}/{path}"))
        .send()
        .await
        .ok()?;
    if !res.status().is_success() {
        return None;
    }
    res.text().await.ok()
}

/// Commits under `rel` from `sha` (exclusive) to HEAD, newest first.
pub async fn commits_since(repo: &Path, sha: &str, rel: &str, web_repo: Option<&str>) -> Result<Vec<Entry>, String> {
    if !plugins::commit_exists(repo, sha).await? {
        return Err(
            "The installed commit isn't in the local marketplace copy, so Skillshelf can't tell which commits are new."
                .into(),
        );
    }
    let path = if rel.is_empty() { "." } else { rel };
    let range = format!("{sha}..HEAD");
    let out = proc::run(
        "git",
        &[
            "-C",
            &repo.display().to_string(),
            "log",
            "--no-color",
            "--format=%H%x1f%cI%x1f%s",
            &range,
            "--",
            path,
        ],
        None,
        GIT_TIMEOUT,
    )
    .await?;
    if !out.success() {
        return Err(format!("git log failed: {}", out.stderr.trim()));
    }
    Ok(parse_git_log(&out.stdout, web_repo))
}

/// Parses `git log --format=%H%x1f%cI%x1f%s` output.
pub fn parse_git_log(out: &str, web_repo: Option<&str>) -> Vec<Entry> {
    out.lines()
        .filter_map(|line| {
            let mut parts = line.splitn(3, '\u{1f}');
            let sha = parts.next()?.trim();
            if sha.is_empty() {
                return None;
            }
            let date = parts
                .next()
                .map(str::trim)
                .filter(|d| !d.is_empty())
                .map(str::to_string);
            let message = parts.next().unwrap_or_default().trim().to_string();
            Some(Entry {
                sha: sha.to_string(),
                date,
                message,
                url: web_repo.map(|r| format!("https://github.com/{r}/commit/{sha}")),
            })
        })
        .collect()
}

async fn remote_github_repo(repo: &Path) -> Option<String> {
    let out = proc::run(
        "git",
        &["-C", &repo.display().to_string(), "remote", "get-url", "origin"],
        None,
        GIT_TIMEOUT,
    )
    .await
    .ok()?;
    out.success().then(|| github_repo(out.stdout.trim())).flatten()
}

async fn git_show(repo: &Path, sha: &str, path: &str) -> Option<String> {
    let spec = format!("{sha}:{path}");
    let out = proc::run(
        "git",
        &["-C", &repo.display().to_string(), "show", &spec],
        None,
        GIT_TIMEOUT,
    )
    .await
    .ok()?;
    out.success().then_some(out.stdout)
}

fn read_changelog_file(dir: &Path) -> Option<(String, String)> {
    let entries = std::fs::read_dir(dir).ok()?;
    let mut names: Vec<String> = entries
        .flatten()
        .filter(|e| e.path().is_file())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| {
            let lower = n.to_ascii_lowercase();
            lower == "changelog.md" || lower == "changes.md"
        })
        .collect();
    names.sort_by_key(|n| !n.to_ascii_lowercase().starts_with("changelog"));
    let name = names.into_iter().next()?;
    let text = std::fs::read_to_string(dir.join(&name)).ok()?;
    Some((name, text))
}

/// Plugins pulled from their own repo, pinned by commit: the GitHub compare API.
async fn external_changes(src: &Map<String, Value>, git_sha: Option<&str>) -> Result<Changelog, String> {
    let kind = src.get("source").and_then(Value::as_str).unwrap_or_default();
    if kind == "npm" {
        return Ok(Changelog::unavailable(
            "This plugin is an npm package, which doesn't come with a history Skillshelf can read.",
        ));
    }
    let url = match kind {
        "github" => src
            .get("repo")
            .and_then(Value::as_str)
            .map(|r| format!("https://github.com/{r}.git")),
        _ => src.get("url").and_then(Value::as_str).map(str::to_string),
    };
    let Some(repo) = url.as_deref().and_then(github_repo) else {
        return Ok(Changelog::unavailable(
            "This plugin's repository isn't on GitHub, so there's no changelog to fetch.",
        ));
    };
    let Some(base) = git_sha else {
        return Ok(Changelog::unavailable(
            "Claude Code didn't record which commit is installed, so the changes can't be listed.",
        ));
    };
    let head = match src.get("sha").and_then(Value::as_str) {
        Some(sha) => sha.to_string(),
        None => {
            plugins::ls_remote(
                url.as_deref().unwrap_or_default(),
                src.get("ref").and_then(Value::as_str),
            )
            .await?
        }
    };
    let v = Github::new()
        .await
        .get(&format!("https://api.github.com/repos/{repo}/compare/{base}...{head}"))
        .await?;
    let mut entries = parse_github_commits(v.get("commits").unwrap_or(&Value::Null));
    entries.reverse(); // compare lists oldest first
    let total = v
        .get("total_commits")
        .and_then(Value::as_u64)
        .map(|n| n as usize)
        .unwrap_or(entries.len());
    let subdir = src.get("path").and_then(Value::as_str).filter(|p| !p.is_empty());
    Ok(Changelog {
        label: format!("Commits in {repo} since the installed commit"),
        total,
        entries: entries.into_iter().take(MAX_ENTRIES).collect(),
        more_url: v.get("html_url").and_then(Value::as_str).map(str::to_string),
        note: subdir.map(|p| format!("Includes commits outside the plugin's folder (`{p}`).")),
        ..Default::default()
    })
}

/// `owner/repo` for GitHub https, ssh and scp-style URLs.
pub fn github_repo(url: &str) -> Option<String> {
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

/// Parses a GitHub list of commits (the commits API, or `commits` in a compare response).
pub fn parse_github_commits(v: &Value) -> Vec<Entry> {
    v.as_array()
        .map(|list| {
            list.iter()
                .filter_map(|c| {
                    let sha = c.get("sha").and_then(Value::as_str)?.to_string();
                    let commit = c.get("commit");
                    let message = commit
                        .and_then(|m| m.get("message"))
                        .and_then(Value::as_str)
                        .and_then(|m| m.lines().next())
                        .unwrap_or_default()
                        .trim()
                        .to_string();
                    let date = commit
                        .and_then(|m| m.pointer("/committer/date").or_else(|| m.pointer("/author/date")))
                        .and_then(Value::as_str)
                        .map(str::to_string);
                    let url = c.get("html_url").and_then(Value::as_str).map(str::to_string);
                    Some(Entry {
                        sha,
                        date,
                        message,
                        url,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

// ---------- skills CLI ----------

async fn skills_cli(repo: Option<&str>, skill_path: &str, since: Option<&str>) -> Result<Changelog, String> {
    let Some(repo) = repo else {
        return Ok(Changelog::unavailable(
            "Only skills installed from GitHub have a history Skillshelf can read.",
        ));
    };
    let Some(since) = since else {
        return Ok(Changelog::unavailable(
            "The skills lockfile doesn't say when this skill was installed, so there's no starting point.",
        ));
    };
    let folder = skill_folder(skill_path);
    let mut params = vec![("since", since), ("per_page", "100")];
    if !folder.is_empty() {
        params.push(("path", folder.as_str()));
    }
    let url = reqwest::Url::parse_with_params(&format!("https://api.github.com/repos/{repo}/commits"), &params)
        .map_err(|e| format!("Bad repository name `{repo}`: {e}"))?;
    let v = Github::new().await.get(url.as_str()).await?;
    let entries = parse_github_commits(&v);
    let path = if folder.is_empty() {
        String::new()
    } else {
        format!("/{folder}")
    };
    let note = if entries.is_empty() {
        Some("GitHub lists no commits to this skill's folder since your last update. The folder may have moved.".into())
    } else if entries.len() == 100 {
        Some("Showing the 100 most recent commits.".into())
    } else {
        None
    };
    Ok(Changelog {
        label: "Commits that touched this skill since your last update".into(),
        total: entries.len(),
        entries: entries.into_iter().take(MAX_ENTRIES).collect(),
        more_url: Some(format!("https://github.com/{repo}/commits/HEAD{path}")),
        note,
        ..Default::default()
    })
}

// ---------- skill-release.json ----------

/// `changelog` and `changelogUrl` from the remote manifest if it has either, else from the local one,
/// so a stale local inline changelog never wins over a remote link.
fn changelog_fields(remote: &Value, local: &Value) -> (Option<String>, Option<String>) {
    let get = |m: &Value, key: &str| {
        m.get(key)
            .and_then(Value::as_str)
            .filter(|s| !s.trim().is_empty())
            .map(str::to_string)
    };
    let from = |m: &Value| (get(m, "changelog"), get(m, "changelogUrl"));
    match from(remote) {
        (None, None) => from(local),
        fields => fields,
    }
}

/// Skills that publish their own update manifest. The changelog comes from a `changelog` (markdown)
/// or `changelogUrl` (a markdown file) field in the remote manifest, else in the local skill-release.json.
async fn release_manifest(
    url: &str,
    installed: Option<&str>,
    latest: Option<&str>,
    dir: Option<&str>,
) -> Result<Changelog, String> {
    let client = http();
    let remote: Value = match client.get(url).send().await {
        Ok(r) if r.status().is_success() => r.json().await.unwrap_or(Value::Null),
        Ok(r) => return Err(format!("Update manifest returned {}", r.status())),
        Err(e) => return Err(format!("Could not fetch update manifest: {e}")),
    };
    let local = dir
        .and_then(|d| read_json(&Path::new(d).join("skill-release.json")))
        .unwrap_or(Value::Null);
    let (text, link) = match changelog_fields(&remote, &local) {
        (Some(text), link) => (text, link),
        (None, Some(link)) => {
            if !link.starts_with("https://") {
                return Ok(Changelog::unavailable(
                    "The changelogUrl in the release manifest isn't an https link.",
                ));
            }
            let text = match client.get(&link).send().await {
                Ok(r) if r.status().is_success() => {
                    r.text().await.map_err(|e| format!("Could not read changelog: {e}"))?
                }
                Ok(r) => return Err(format!("Changelog returned {}", r.status())),
                Err(e) => return Err(format!("Could not fetch changelog: {e}")),
            };
            (text, Some(link))
        }
        (None, None) => {
            return Ok(Changelog::unavailable(
                "This skill's release manifest has no changelog. Its author can add a `changelog` or `changelogUrl` field.",
            ));
        }
    };

    let sections = release_notes(&text, installed, latest);
    let mut log = Changelog {
        label: "Release notes".into(),
        sections_label: Some("the skill's release manifest".into()),
        more_url: link,
        ..Default::default()
    };
    if sections.is_empty() {
        log.note = Some("The changelog has no entries newer than your version.".into());
    }
    log.sections = sections;
    Ok(log)
}

/// Sections between the installed and latest versions; a changelog without version headings is shown whole.
pub fn release_notes(text: &str, installed: Option<&str>, latest: Option<&str>) -> Vec<Section> {
    if parse_sections(text).is_empty() {
        let body = clip(text.trim());
        return if body.is_empty() {
            Vec::new()
        } else {
            vec![Section {
                version: latest.map(str::to_string),
                title: latest
                    .map(|l| format!("Release {l}"))
                    .unwrap_or_else(|| "Release notes".into()),
                body,
            }]
        };
    }
    match installed.and_then(parse_version) {
        Some(after) => sections_between(text, &after, latest.and_then(parse_version).as_ref()),
        None => Vec::new(),
    }
}

fn http() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(concat!("skillshelf/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(20))
        .build()
        .expect("http client")
}

// ---------- changelog markdown ----------

pub fn parse_version(s: &str) -> Option<semver::Version> {
    let s = s.trim().trim_start_matches(['v', 'V']);
    semver::Version::parse(s).ok().or_else(|| {
        semver::Version::parse(&format!("{s}.0"))
            .ok()
            .filter(|_| s.matches('.').count() == 1)
    })
}

/// The first semver-looking word in a heading: `[1.4.0] - 2026-09-01` → 1.4.0.
fn heading_version(title: &str) -> Option<semver::Version> {
    title
        .split(|c: char| c.is_whitespace() || "[]()`*_:,".contains(c))
        .find_map(|w| parse_version(w.trim_end_matches('.')).filter(|_| w.contains('.')))
}

/// Every versioned section of a changelog, in file order. A section runs until the next heading
/// at the same or a higher level, so `### Added` subsections stay inside their release.
pub fn parse_sections(md: &str) -> Vec<Section> {
    struct Open {
        level: usize,
        version: semver::Version,
        title: String,
        body: Vec<String>,
    }
    let mut out = Vec::new();
    let mut open: Option<Open> = None;
    let mut fenced = false;
    let close = |o: Open, out: &mut Vec<Section>| {
        out.push(Section {
            version: Some(o.version.to_string()),
            title: o.title,
            body: clip(o.body.join("\n").trim()),
        })
    };

    for line in md.lines() {
        if line.trim_start().starts_with("```") {
            fenced = !fenced;
        }
        let level = line.chars().take_while(|&c| c == '#').count();
        let is_heading = !fenced && (1..=6).contains(&level) && line[level..].starts_with(' ');
        if is_heading {
            let title = line[level..].trim().trim_end_matches('#').trim().to_string();
            if open.as_ref().is_some_and(|o| level <= o.level)
                && let Some(o) = open.take()
            {
                close(o, &mut out);
            }
            if open.is_none() {
                let title = strip_links(&title);
                if let Some(version) = heading_version(&title) {
                    open = Some(Open {
                        level,
                        version,
                        title,
                        body: Vec::new(),
                    });
                }
                continue;
            }
        }
        if let Some(o) = open.as_mut() {
            o.body.push(line.to_string());
        }
    }
    if let Some(o) = open {
        close(o, &mut out);
    }
    out
}

/// Releases newer than `after` and, when given, no newer than `upto`; newest first.
pub fn sections_between(md: &str, after: &semver::Version, upto: Option<&semver::Version>) -> Vec<Section> {
    let mut found: Vec<(semver::Version, Section)> = parse_sections(md)
        .into_iter()
        .filter_map(|s| Some((parse_version(s.version.as_deref()?)?, s)))
        .filter(|(v, _)| v > after && upto.is_none_or(|u| v <= u))
        .collect();
    found.sort_by(|a, b| b.0.cmp(&a.0));
    found.dedup_by(|a, b| a.0 == b.0);
    found.into_iter().take(MAX_SECTIONS).map(|(_, s)| s).collect()
}

pub fn newest_version(md: &str) -> Option<semver::Version> {
    parse_sections(md)
        .iter()
        .filter_map(|s| parse_version(s.version.as_deref()?))
        .max()
}

/// `[1.7.4](https://…) (2026-10-15)` → `1.7.4 (2026-10-15)`.
fn strip_links(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(open) = rest.find('[') {
        let after = &rest[open + 1..];
        let link = after
            .find("](")
            .and_then(|close| Some((close, after[close + 2..].find(')')?)));
        match link {
            Some((close, end)) => {
                out.push_str(&rest[..open]);
                out.push_str(&after[..close]);
                rest = &after[close + 2 + end + 1..];
            }
            None => {
                out.push_str(&rest[..=open]);
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

fn clip(s: &str) -> String {
    if s.chars().count() <= MAX_SECTION_CHARS {
        return s.to_string();
    }
    let mut cut: String = s.chars().take(MAX_SECTION_CHARS).collect();
    cut.push_str("\n\n…");
    cut
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

    fn commit(dir: &Path, file: &str, content: &str, message: &str) -> String {
        let path = dir.join(file);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, content).unwrap();
        git(dir, &["add", "."]);
        git(dir, &["commit", "-qm", message]);
        git(dir, &["rev-parse", "HEAD"])
    }

    fn init_repo() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path();
        git(p, &["init", "-q"]);
        git(p, &["config", "user.email", "t@example.com"]);
        git(p, &["config", "user.name", "t"]);
        git(p, &["config", "commit.gpgsign", "false"]);
        dir
    }

    const CHANGELOG: &str = "# Changelog\n\n## [Unreleased]\n- wip\n\n## [1.3.0] - 2026-10-01\n### Added\n- Dark mode\n\n```md\n## 9.9.9 not a heading\n```\n\n## [1.2.1] - 2026-09-12\n### Fixed\n- Crash on start\n\n## 1.2.0\n- First\n\n# Older\n## v1.1\n- Old\n";

    #[test]
    fn changelog_sections_keep_subheadings_and_skip_code() {
        let s = parse_sections(CHANGELOG);
        let versions: Vec<_> = s.iter().map(|s| s.version.clone().unwrap()).collect();
        assert_eq!(versions, ["1.3.0", "1.2.1", "1.2.0", "1.1.0"]);
        assert_eq!(s[0].title, "[1.3.0] - 2026-10-01");
        assert!(s[0].body.starts_with("### Added\n- Dark mode"));
        assert!(s[0].body.contains("9.9.9 not a heading"));
        assert_eq!(s[2].body, "- First");
        assert_eq!(newest_version(CHANGELOG), Some(semver::Version::new(1, 3, 0)));
    }

    #[test]
    fn changelog_sections_between_versions() {
        let v = |s| parse_version(s).unwrap();
        let got: Vec<_> = sections_between(CHANGELOG, &v("1.2.0"), None)
            .into_iter()
            .map(|s| s.version.unwrap())
            .collect();
        assert_eq!(got, ["1.3.0", "1.2.1"]);
        let got: Vec<_> = sections_between(CHANGELOG, &v("v1.1"), Some(&v("1.2.1")))
            .into_iter()
            .map(|s| s.version.unwrap())
            .collect();
        assert_eq!(got, ["1.2.1", "1.2.0"]);
        assert!(sections_between(CHANGELOG, &v("1.3.0"), None).is_empty());
    }

    #[test]
    fn release_notes_without_versions_are_shown_whole() {
        let s = release_notes("Fixed the thing.\n", Some("1.0.0"), Some("1.1.0"));
        assert_eq!(s.len(), 1);
        assert_eq!(s[0].title, "Release 1.1.0");
        assert_eq!(s[0].body, "Fixed the thing.");
        let s = release_notes(CHANGELOG, Some("1.2.1"), Some("1.3.0"));
        assert_eq!(s.len(), 1);
        assert_eq!(s[0].version.as_deref(), Some("1.3.0"));
        assert!(release_notes(CHANGELOG, Some("not-semver"), None).is_empty());
    }

    #[test]
    fn release_please_headings() {
        let md = "## [1.7.4](https://github.com/o/r/compare/v1.7.3...v1.7.4) (2026-10-15)\n### Bug Fixes\n- x\n";
        let s = parse_sections(md);
        assert_eq!(s[0].version.as_deref(), Some("1.7.4"));
        assert_eq!(s[0].title, "1.7.4 (2026-10-15)");
        assert_eq!(strip_links("[a] b [c](d"), "[a] b [c](d");
    }

    #[test]
    fn git_log_output_parsing() {
        let out = "abc123\u{1f}2026-10-01T10:00:00+02:00\u{1f}Fix: a | b\n\ndef456\u{1f}\u{1f}\n";
        let e = parse_git_log(out, Some("o/r"));
        assert_eq!(e.len(), 2);
        assert_eq!(e[0].message, "Fix: a | b");
        assert_eq!(e[0].date.as_deref(), Some("2026-10-01T10:00:00+02:00"));
        assert_eq!(e[0].url.as_deref(), Some("https://github.com/o/r/commit/abc123"));
        assert_eq!(e[1].date, None);
        assert!(parse_git_log(out, None)[0].url.is_none());
    }

    #[test]
    fn github_urls() {
        for url in [
            "https://github.com/o/r.git",
            "https://github.com/o/r",
            "git@github.com:o/r.git",
            "ssh://git@github.com/o/r",
            "https://github.com/o/r/tree/main/x",
        ] {
            assert_eq!(github_repo(url).as_deref(), Some("o/r"), "{url}");
        }
        assert_eq!(github_repo("https://gitlab.com/o/r.git"), None);
    }

    #[test]
    fn github_commit_list_parsing() {
        let v = json!([{
            "sha": "abc",
            "html_url": "https://github.com/o/r/commit/abc",
            "commit": {"message": "Title line\n\nBody", "committer": {"date": "2026-10-01T00:00:00Z"}}
        }]);
        assert_eq!(
            parse_github_commits(&v),
            vec![Entry {
                sha: "abc".into(),
                date: Some("2026-10-01T00:00:00Z".into()),
                message: "Title line".into(),
                url: Some("https://github.com/o/r/commit/abc".into()),
            }]
        );
    }

    #[tokio::test]
    async fn marketplace_commits_only_for_the_plugin_folder() {
        let repo = init_repo();
        let p = repo.path();
        let installed = commit(p, "plugins/a/x.md", "1", "one");
        commit(p, "plugins/b/y.md", "1", "touch b");
        commit(p, "plugins/a/x.md", "2", "touch a");
        commit(p, "plugins/a/sub/z.md", "1", "add a/sub");

        let log = marketplace_changes(p, "plugins/a", Some(&installed[..12]), Some(&installed)).await;
        let messages: Vec<_> = log.entries.iter().map(|e| e.message.as_str()).collect();
        assert_eq!(messages, ["add a/sub", "touch a"]);
        assert_eq!(log.total, 2);
        assert_eq!(log.note, None);
        assert!(log.entries[0].date.is_some());
        assert!(log.entries[0].url.is_none(), "no GitHub remote");

        let head = git(p, &["rev-parse", "HEAD"]);
        let log = marketplace_changes(p, "plugins/a", None, Some(&head)).await;
        assert!(log.entries.is_empty());
        assert!(log.note.unwrap().contains("No commits"));
    }

    #[tokio::test]
    async fn marketplace_unknown_commit_is_reported() {
        let repo = init_repo();
        commit(repo.path(), "plugins/a/x.md", "1", "one");
        let log = marketplace_changes(
            repo.path(),
            "plugins/a",
            None,
            Some("0123456789abcdef0123456789abcdef01234567"),
        )
        .await;
        assert!(log.entries.is_empty());
        assert!(log.note.unwrap().contains("isn't in the local marketplace copy"));
    }

    #[tokio::test]
    async fn marketplace_changelog_sections_from_semver_or_installed_commit() {
        let repo = init_repo();
        let p = repo.path();
        let installed = commit(p, "plugins/a/CHANGELOG.md", "## 1.0.0\n- Start\n", "v1");
        commit(
            p,
            "plugins/a/CHANGELOG.md",
            "## 1.1.0\n- New\n\n## 1.0.0\n- Start\n",
            "v1.1",
        );

        // Semver installed version.
        let log = marketplace_changes(p, "plugins/a", Some("1.0.0"), Some(&installed)).await;
        assert_eq!(log.sections.len(), 1);
        assert_eq!(log.sections[0].body, "- New");
        assert_eq!(log.sections_label.as_deref(), Some("CHANGELOG.md"));

        // Installed by commit: the installed copy of CHANGELOG.md gives the baseline.
        let log = marketplace_changes(p, "plugins/a", Some(&installed[..12]), Some(&installed)).await;
        assert_eq!(log.sections.len(), 1);
        assert_eq!(log.sections[0].version.as_deref(), Some("1.1.0"));
    }

    #[tokio::test]
    async fn archive_marketplace_has_no_commits() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("plugins/a")).unwrap();
        std::fs::write(
            dir.path().join("plugins/a/CHANGELOG.md"),
            "## 2.0.0\n- Big\n## 1.0.0\n- Start\n",
        )
        .unwrap();
        let log = marketplace_changes(dir.path(), "plugins/a", Some("1.0.0"), Some("abc1234")).await;
        assert!(log.entries.is_empty());
        assert!(log.note.unwrap().contains("without git history"));
        assert_eq!(log.sections.len(), 1);
    }

    #[tokio::test]
    async fn synced_and_local_items_have_no_changelog() {
        use crate::model::Kind;
        let synced = Item::new("p".into(), Kind::Plugin, Source::Synced, "p".into());
        let log = for_item(&synced).await.unwrap();
        assert!(log.entries.is_empty() && log.sections.is_empty());
        assert!(log.note.unwrap().contains("organization"));
        let local = Item::new("s".into(), Kind::Skill, Source::Local, "s".into());
        assert!(for_item(&local).await.unwrap().note.unwrap().contains("No installer"));
    }

    #[test]
    fn remote_changelog_fields_win_as_a_unit() {
        let local = json!({"changelog": "stale local notes"});
        let remote = json!({"changelogUrl": "https://example.com/CHANGELOG.md"});
        assert_eq!(
            changelog_fields(&remote, &local),
            (None, Some("https://example.com/CHANGELOG.md".into()))
        );
        assert_eq!(
            changelog_fields(&json!({}), &local),
            (Some("stale local notes".into()), None)
        );
    }

    #[test]
    fn retryable_results_keep_links_but_are_refetched() {
        let key: CacheKey = ("test:retryable".into(), Some("1".into()), Some("2".into()));
        let log = Changelog {
            more_url: Some("https://github.com/o/r/commits/HEAD".into()),
            retryable: true,
            ..Default::default()
        };
        remember(key.clone(), log);
        assert!(cached(&key).is_none());
        assert!(is_known_link("test:retryable", "https://github.com/o/r/commits/HEAD"));
    }
}

#[cfg(test)]
mod smoke {
    /// Changelogs for this machine's items with an update. Run with
    /// `cargo test changelog_real_machine -- --ignored --nocapture`.
    #[tokio::test]
    #[ignore]
    async fn changelog_real_machine() {
        let scanned = crate::scan::scan_all(&crate::settings::Settings::default()).await;
        let checked = crate::updates::check_all(scanned.items).await;
        for i in checked
            .items
            .iter()
            .filter(|i| i.status == crate::model::Status::UpdateAvailable)
        {
            match super::for_item(i).await {
                Ok(log) => println!(
                    "{:?} {:<36} {} entries ({} total), {} sections, label={:?} note={:?} more={:?}\n    first={:?}",
                    i.source,
                    i.name,
                    log.entries.len(),
                    log.total,
                    log.sections.len(),
                    log.label,
                    log.note,
                    log.more_url,
                    log.entries.first().map(|e| (&e.message, &e.url)),
                ),
                Err(e) => println!("{:?} {:<36} ERROR {e}", i.source, i.name),
            }
        }
    }
}
