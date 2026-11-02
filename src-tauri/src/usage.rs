//! How often each skill, command, agent and plugin MCP server was used, counted from the session
//! transcripts in ~/.claude/projects. Only bytes appended since the last run are read, and the
//! uses found are cached in the app data folder. This module has no network code: transcripts never
//! leave the machine.

use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use regex::bytes::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::model::{Item, Kind, Source, now_ms};
use crate::paths;

const WINDOW_DAYS: u32 = 30;
/// Bump when the counting rules change, so old caches are rebuilt.
const INDEX_VERSION: u32 = 2;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    /// Uses in the last 30 days.
    pub uses: u32,
    /// Timestamp of the last use in any transcript on disk.
    pub last_used: Option<String>,
    /// Uses per day for the last 30 days, oldest first, ending today (UTC).
    pub daily: Vec<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageReport {
    pub by_item: HashMap<String, Usage>,
    pub files: usize,
    pub indexed_at: u64,
}

/// Uses of one key (`skill:x`, `command:x`, `agent:x`, `mcp:plugin_p_server`).
#[derive(Debug, Clone, Default, PartialEq)]
struct Counts {
    /// Day number (days since 1970-01-01, UTC) → uses.
    days: HashMap<u32, u32>,
    last: Option<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct FileState {
    /// Bytes read so far, always at a line boundary.
    offset: u64,
    /// Tool use id (a typed command's line uuid) → `(key, timestamp)`. Resumed and forked sessions
    /// copy earlier lines into their new file, so totals count each id once.
    uses: HashMap<String, (String, String)>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct Index {
    version: u32,
    files: HashMap<String, FileState>,
}

/// Updates the cached index with what was appended to the transcripts, then credits each item.
/// `on_progress(read, to_read)` is called as bytes are read, about every 1%.
pub fn report(items: &[Item], cache: &Path, mut on_progress: impl FnMut(u64, u64)) -> Result<UsageReport, String> {
    let mut index: Index = std::fs::read(cache)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .filter(|i: &Index| i.version == INDEX_VERSION)
        .unwrap_or_default();
    index.version = INDEX_VERSION;

    let files = transcripts(&paths::claude_dir().join("projects"));
    let mut sizes = Vec::new();
    for path in &files {
        let key = path.display().to_string();
        let len = std::fs::metadata(path).map_or(0, |m| m.len());
        let state = index.files.entry(key.clone()).or_default();
        if len < state.offset {
            *state = FileState::default(); // rewritten: count it again from the start
        }
        sizes.push((key, len - state.offset));
    }
    let keep: std::collections::HashSet<String> = sizes.iter().map(|(k, _)| k.clone()).collect();
    index.files.retain(|k, _| keep.contains(k));

    let to_read: u64 = sizes.iter().map(|(_, n)| n).sum();
    let step = (to_read / 100).max(1);
    let (mut read, mut reported) = (0u64, 0u64);
    for (key, new_bytes) in sizes {
        if new_bytes == 0 {
            continue;
        }
        let state = index.files.get_mut(&key).expect("added above");
        // An unreadable file (locked, deleted meanwhile) is retried on the next run.
        let _ = read_appended(Path::new(&key), state);
        read += new_bytes;
        if read - reported >= step {
            reported = read;
            on_progress(read, to_read);
        }
    }
    on_progress(to_read, to_read);

    if let Some(dir) = cache.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let json = serde_json::to_vec(&index).map_err(|e| e.to_string())?;
    crate::settings::write_atomic(cache, &json).map_err(|e| format!("Could not save the usage index: {e}"))?;

    let root = paths::claude_dir().join("projects");
    let all = totals(index.files.values());
    let today = (now_ms() / 86_400_000) as u32;
    Ok(UsageReport {
        by_item: items
            .iter()
            .map(|i| (i.id.clone(), usage_for(i, &index, &root, &all, today)))
            .collect(),
        files: files.len(),
        indexed_at: now_ms(),
    })
}

fn totals<'a>(files: impl Iterator<Item = &'a FileState>) -> HashMap<&'a str, Counts> {
    let mut seen = HashSet::new();
    let mut totals: HashMap<&str, Counts> = HashMap::new();
    for (id, (key, ts)) in files.flat_map(|s| &s.uses) {
        let Some(day) = day_number(ts).filter(|_| seen.insert(id)) else {
            continue;
        };
        let t = totals.entry(key.as_str()).or_default();
        *t.days.entry(day).or_default() += 1;
        if t.last.as_deref() < Some(ts.as_str()) {
            t.last = Some(ts.clone());
        }
    }
    totals
}

/// A project's skills only load in sessions inside that project, so only those sessions count.
fn usage_for(item: &Item, index: &Index, root: &Path, all: &HashMap<&str, Counts>, today: u32) -> Usage {
    let Some(project) = item.meta.get("Project").filter(|_| item.source == Source::Project) else {
        return credit(item, all, today);
    };
    let project = transcript_folder(project);
    let files = index.files.iter().filter(|(path, _)| {
        Path::new(path)
            .strip_prefix(root)
            .ok()
            .and_then(|rel| rel.components().next())
            .is_some_and(|c| in_project(&c.as_os_str().to_string_lossy(), &project))
    });
    credit(item, &totals(files.map(|(_, s)| s)), today)
}

/// The folder in ~/.claude/projects that Claude Code keeps a directory's sessions in: every
/// character that isn't an ASCII letter or digit becomes `-`.
fn transcript_folder(dir: &str) -> String {
    dir.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

/// Whether sessions in transcript folder `folder` ran in the project or a folder inside it.
// shortcut: also matches a sibling whose name extends the project's after a symbol ("app-old" for "app"); fine until such pairs show up.
fn in_project(folder: &str, project: &str) -> bool {
    let (folder, project) = (folder.to_ascii_lowercase(), project.to_ascii_lowercase());
    folder == project || folder.starts_with(&format!("{project}-"))
}

fn transcripts(root: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for entry in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
            let path = entry.path();
            match entry.file_type() {
                Ok(t) if t.is_dir() => stack.push(path),
                Ok(t) if t.is_file() && path.extension().is_some_and(|e| e == "jsonl") => out.push(path),
                _ => {}
            }
        }
    }
    out
}

fn read_appended(path: &Path, state: &mut FileState) -> std::io::Result<()> {
    let mut reader = BufReader::with_capacity(1 << 20, File::open(path)?);
    reader.seek(SeekFrom::Start(state.offset))?;
    let mut line = Vec::new();
    loop {
        line.clear();
        let n = reader.read_until(b'\n', &mut line)?;
        // A last line without its newline is still being written; read it next time.
        if n == 0 || line.last() != Some(&b'\n') {
            return Ok(());
        }
        state.offset += n as u64;
        for (id, key, timestamp) in uses_in_line(&line) {
            if day_number(&timestamp).is_some() {
                state.uses.insert(id, (key, timestamp));
            }
        }
    }
}

#[derive(Deserialize)]
struct Line {
    #[serde(rename = "type", default)]
    kind: String,
    uuid: Option<String>,
    timestamp: Option<String>,
    message: Option<Message>,
}

#[derive(Deserialize)]
struct Message {
    #[serde(default)]
    content: Value,
}

/// `(id, key, timestamp)` for each use in one transcript line. Only assistant tool calls and the
/// user's slash commands count; the same names inside tool results or request snapshots are ignored.
fn uses_in_line(line: &[u8]) -> Vec<(String, String, String)> {
    static MARKER: OnceLock<Regex> = OnceLock::new();
    let marker = MARKER.get_or_init(|| {
        Regex::new(r#""name":"Skill"|"subagent_type":"|<command-name>/|"name":"mcp__plugin_"#).unwrap()
    });
    if !marker.is_match(line) {
        return Vec::new();
    }
    let Ok(Line {
        kind,
        uuid,
        timestamp: Some(ts),
        message: Some(msg),
    }) = serde_json::from_slice::<Line>(line)
    else {
        return Vec::new();
    };
    let mut keys = Vec::new();
    match kind.as_str() {
        "assistant" => {
            for block in msg.content.as_array().into_iter().flatten() {
                if block.get("type").and_then(Value::as_str) != Some("tool_use") {
                    continue;
                }
                let Some(id) = block.get("id").and_then(Value::as_str) else {
                    continue;
                };
                let name = block.get("name").and_then(Value::as_str).unwrap_or("");
                let input = |k: &str| block.pointer(&format!("/input/{k}")).and_then(Value::as_str);
                let key = match name {
                    "Skill" => input("skill").map(|s| format!("skill:{s}")),
                    "Agent" | "Task" => input("subagent_type").map(|s| format!("agent:{s}")),
                    _ => name
                        .strip_prefix("mcp__")
                        .and_then(|r| r.split("__").next())
                        .filter(|server| server.starts_with("plugin_"))
                        .map(|server| format!("mcp:{server}")),
                };
                keys.extend(key.map(|k| (id.to_string(), k)));
            }
        }
        "user" => {
            let text = match &msg.content {
                Value::String(s) => Some(s.as_str()),
                Value::Array(a) => a.first().and_then(|b| b.get("text")).and_then(Value::as_str),
                _ => None,
            };
            // A typed command starts the message; anywhere else it's text that mentions one.
            if let Some(t) = text.filter(|t| t.trim_start().starts_with("<command-"))
                && let Some(name) = t
                    .split("<command-name>/")
                    .nth(1)
                    .and_then(|r| r.split("</command-name>").next())
                && let Some(id) = uuid
            {
                keys.push((id, format!("command:{}", name.trim())));
            }
        }
        _ => {}
    }
    keys.into_iter().map(|(id, k)| (id, k, ts.clone())).collect()
}

/// What counts as a use of this item: a plugin gets its namespaced skills, commands, agents and
/// MCP servers; a skill gets the Skill tool and its slash command.
fn credit(item: &Item, totals: &HashMap<&str, Counts>, today: u32) -> Usage {
    let p = &item.name;
    let mine = |key: &str| match item.kind {
        Kind::Plugin => {
            ["skill:", "command:", "agent:"].iter().any(|kind| {
                key.strip_prefix(kind)
                    .is_some_and(|rest| rest.starts_with(&format!("{p}:")))
            }) || key.starts_with(&format!("mcp:plugin_{p}_"))
        }
        Kind::Skill => key == format!("skill:{p}") || key == format!("command:{p}"),
    };
    let first = today.saturating_sub(WINDOW_DAYS - 1);
    let mut usage = Usage {
        uses: 0,
        last_used: None,
        daily: vec![0; WINDOW_DAYS as usize],
    };
    for (_, c) in totals.iter().filter(|(k, _)| mine(k)) {
        for (day, n) in &c.days {
            if (first..=today).contains(day) {
                usage.daily[(day - first) as usize] += n;
                usage.uses += n;
            }
        }
        if c.last > usage.last_used {
            usage.last_used = c.last.clone();
        }
    }
    usage
}

/// `2026-10-23T06:43:02.042Z` → days since 1970-01-01.
fn day_number(ts: &str) -> Option<u32> {
    let mut parts = ts.get(..10)?.split('-').map(|p| p.parse::<i64>().ok());
    let (y, m, d) = (parts.next()??, parts.next()??, parts.next()??);
    // Howard Hinnant's days_from_civil.
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * ((m + 9) % 12) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    u32::try_from(era * 146_097 + doe - 719_468).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    const SKILL: &str = r#"{"parentUuid":"x","type":"assistant","timestamp":"2026-10-23T06:43:02.042Z","message":{"content":[{"type":"tool_use","id":"toolu_1","name":"Skill","input":{"skill":"ui-ux-pro-max:ui-ux-pro-max","args":"x"}}]}}"#;
    const AGENT: &str = r#"{"type":"assistant","timestamp":"2026-10-24T01:00:00Z","message":{"content":[{"type":"tool_use","id":"t","name":"Agent","input":{"description":"d","subagent_type":"pm-skills:cs-pm-orchestrator"}}]},"wireToolInputs":{"t":{"subagent_type":"pm-skills:cs-pm-orchestrator"}}}"#;
    const MCP: &str = r#"{"type":"assistant","timestamp":"2026-10-24T02:00:00Z","message":{"content":[{"type":"tool_use","id":"t","name":"mcp__plugin_runpod_runpod__create-pod","input":{}}]}}"#;
    const COMMAND: &str = r#"{"type":"user","uuid":"u1","timestamp":"2026-10-24T03:00:00Z","message":{"role":"user","content":"<command-message>runpod:runpod-mcp</command-message>\n<command-name>/runpod:runpod-mcp</command-name>"}}"#;
    const MENTION: &str = r#"{"type":"user","timestamp":"2026-10-24T03:00:00Z","message":{"content":"Commands look like <command-name>/x</command-name>"}}"#;
    const SNAPSHOT: &str = r#"{"type":"api-request-shape","timestamp":"2026-10-24T03:00:00Z","shape":{"messages":[{"type":"tool_use","name":"Skill","input":{"skill":"dataviz"}}]}}"#;

    fn keys(line: &str) -> Vec<String> {
        uses_in_line(line.as_bytes()).into_iter().map(|(_, k, _)| k).collect()
    }

    #[test]
    fn counts_tool_calls_and_typed_commands_only() {
        assert_eq!(keys(SKILL), ["skill:ui-ux-pro-max:ui-ux-pro-max"]);
        assert_eq!(
            keys(AGENT),
            ["agent:pm-skills:cs-pm-orchestrator"],
            "wireToolInputs isn't a second use"
        );
        assert_eq!(keys(MCP), ["mcp:plugin_runpod_runpod"]);
        assert_eq!(keys(COMMAND), ["command:runpod:runpod-mcp"]);
        assert!(keys(MENTION).is_empty());
        assert!(keys(SNAPSHOT).is_empty());
    }

    /// Times the first and an incremental run on this machine's transcripts.
    /// `cargo test usage_real_machine -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn usage_real_machine() {
        let dir = tempfile::tempdir().unwrap();
        let cache = dir.path().join("usage-index.json");
        let items = vec![
            Item::new("p".into(), Kind::Plugin, Source::Marketplace, "runpod".into()),
            Item::new("s".into(), Kind::Skill, Source::SkillsCli, "dataviz".into()),
        ];
        for run in ["first", "incremental"] {
            let t = std::time::Instant::now();
            let r = report(&items, &cache, |_, _| {}).unwrap();
            println!("{run}: {} files in {:?}, {:?}", r.files, t.elapsed(), r.by_item);
        }
        println!("cache {} KB", std::fs::metadata(&cache).unwrap().len() / 1024);
    }

    #[test]
    fn day_numbers() {
        assert_eq!(day_number("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(day_number("2000-03-01"), Some(11_017));
        assert_eq!(day_number("2026-10-31T23:59:59Z"), Some(20_757));
        assert_eq!(day_number("garbage"), None);
    }

    #[test]
    fn reads_only_appended_complete_lines() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("s.jsonl");
        std::fs::write(&file, format!("{SKILL}\n{MCP}")).unwrap(); // MCP line not finished yet
        let mut state = FileState::default();
        read_appended(&file, &mut state).unwrap();
        assert_eq!(state.offset as usize, SKILL.len() + 1);
        assert_eq!(state.uses.len(), 1);

        let mcp2 = MCP.replace(r#""id":"t""#, r#""id":"t2""#);
        std::fs::write(&file, format!("{SKILL}\n{MCP}\n{mcp2}\n")).unwrap();
        read_appended(&file, &mut state).unwrap();
        read_appended(&file, &mut state).unwrap(); // nothing new
        assert_eq!(state.offset as usize, SKILL.len() + MCP.len() + mcp2.len() + 3);
        let all = totals(std::iter::once(&state));
        let mcp = &all["mcp:plugin_runpod_runpod"];
        assert_eq!(mcp.days.values().sum::<u32>(), 2);
        assert_eq!(mcp.last.as_deref(), Some("2026-10-24T02:00:00Z"));
        assert_eq!(all["skill:ui-ux-pro-max:ui-ux-pro-max"].days.values().sum::<u32>(), 1);
    }

    #[test]
    fn a_use_copied_into_another_transcript_counts_once() {
        let dir = tempfile::tempdir().unwrap();
        // A resumed session starts its file with copies of the earlier lines.
        let original = format!("{SKILL}\n{COMMAND}\n");
        let states: Vec<FileState> = [original.clone(), format!("{original}{MCP}\n")]
            .iter()
            .enumerate()
            .map(|(n, text)| {
                let file = dir.path().join(format!("{n}.jsonl"));
                std::fs::write(&file, text).unwrap();
                let mut state = FileState::default();
                read_appended(&file, &mut state).unwrap();
                state
            })
            .collect();
        let all = totals(states.iter());
        let uses = |key: &str| all[key].days.values().sum::<u32>();
        assert_eq!(uses("skill:ui-ux-pro-max:ui-ux-pro-max"), 1);
        assert_eq!(uses("command:runpod:runpod-mcp"), 1);
        assert_eq!(uses("mcp:plugin_runpod_runpod"), 1);
    }

    #[test]
    fn credits_plugins_and_skills() {
        let today = day_number("2026-10-31").unwrap();
        let counts = |day: &str, n: u32, last: &str| Counts {
            days: HashMap::from([(day_number(day).unwrap(), n)]),
            last: Some(last.into()),
        };
        let totals: HashMap<&str, Counts> = HashMap::from([
            (
                "skill:runpod:pod-doctor",
                counts("2026-10-30", 2, "2026-10-30T01:00:00Z"),
            ),
            (
                "mcp:plugin_runpod_runpod",
                counts("2026-10-31", 5, "2026-10-31T01:00:00Z"),
            ),
            ("agent:runpod-extra:x", counts("2026-10-31", 9, "z")), // another plugin whose name starts the same
            ("command:dataviz", counts("2026-09-01", 4, "2026-09-01T00:00:00Z")), // outside the 30 days
        ]);
        let plugin = Item::new(
            "plugin:runpod@runpod:user".into(),
            Kind::Plugin,
            Source::Marketplace,
            "runpod".into(),
        );
        let u = credit(&plugin, &totals, today);
        assert_eq!(u.uses, 7);
        assert_eq!((u.daily[28], u.daily[29]), (2, 5));
        assert_eq!(u.last_used.as_deref(), Some("2026-10-31T01:00:00Z"));

        let skill = Item::new("skill:dataviz".into(), Kind::Skill, Source::Local, "dataviz".into());
        let u = credit(&skill, &totals, today);
        assert_eq!(u.uses, 0, "only the last 30 days count");
        assert_eq!(u.last_used.as_deref(), Some("2026-09-01T00:00:00Z"));
    }

    #[test]
    fn project_skills_count_only_their_projects_sessions() {
        let today = day_number("2026-10-31").unwrap();
        let used = |file: &str, n: u32| FileState {
            offset: 1,
            uses: (0..n)
                .map(|i| {
                    (
                        format!("{file}-{i}"),
                        ("skill:deploy".into(), "2026-10-31T00:00:00Z".into()),
                    )
                })
                .collect(),
        };
        let index = Index {
            version: INDEX_VERSION,
            files: HashMap::from([
                ("/p/C--work-app/s1.jsonl".to_string(), used("s1", 1)),
                ("/p/C--work-app-api/s2.jsonl".to_string(), used("s2", 2)), // a folder inside the project
                ("/p/C--work-shop/s3.jsonl".to_string(), used("s3", 4)),
            ]),
        };
        let all = totals(index.files.values());
        let project = |dir: &str| {
            let mut i = Item::new(
                format!("project:{dir}:deploy"),
                Kind::Skill,
                Source::Project,
                "deploy".into(),
            );
            i.meta.insert("Project".into(), dir.into());
            i
        };
        let root = Path::new("/p");
        assert_eq!(transcript_folder(r"C:\work\app"), "C--work-app");
        assert_eq!(usage_for(&project(r"C:\work\app"), &index, root, &all, today).uses, 3);
        assert_eq!(usage_for(&project(r"c:\work\shop"), &index, root, &all, today).uses, 4);
        let user = Item::new("skill:deploy".into(), Kind::Skill, Source::Local, "deploy".into());
        assert_eq!(usage_for(&user, &index, root, &all, today).uses, 7);
    }
}
