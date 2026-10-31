//! How often each skill, command, agent and plugin MCP server was used, counted from the session
//! transcripts in ~/.claude/projects. Only bytes appended since the last run are read, and the
//! counts are cached in the app data folder. This module has no network code: transcripts never
//! leave the machine.

use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use regex::bytes::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::model::{Item, Kind, now_ms};
use crate::paths;

const WINDOW_DAYS: u32 = 30;
/// Bump when the counting rules change, so old caches are rebuilt.
const INDEX_VERSION: u32 = 1;

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

/// Uses of one key (`skill:x`, `command:x`, `agent:x`, `mcp:plugin_p_server`) in one file.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
struct Counts {
    /// Day number (days since 1970-01-01, UTC) → uses.
    days: HashMap<u32, u32>,
    last: Option<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct FileState {
    /// Bytes read so far, always at a line boundary.
    offset: u64,
    counts: HashMap<String, Counts>,
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

    let tmp = cache.with_extension("tmp");
    if let Some(dir) = cache.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let json = serde_json::to_vec(&index).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, json)
        .and_then(|_| std::fs::rename(&tmp, cache))
        .map_err(|e| format!("Could not save the usage index: {e}"))?;

    let mut totals: HashMap<&str, Counts> = HashMap::new();
    for state in index.files.values() {
        for (key, c) in &state.counts {
            let t = totals.entry(key.as_str()).or_default();
            for (day, n) in &c.days {
                *t.days.entry(*day).or_default() += n;
            }
            if c.last > t.last {
                t.last = c.last.clone();
            }
        }
    }
    let today = (now_ms() / 86_400_000) as u32;
    Ok(UsageReport {
        by_item: items
            .iter()
            .map(|i| (i.id.clone(), credit(i, &totals, today)))
            .collect(),
        files: files.len(),
        indexed_at: now_ms(),
    })
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
        for (key, timestamp) in uses_in_line(&line) {
            let Some(day) = day_number(&timestamp) else { continue };
            let c = state.counts.entry(key).or_default();
            *c.days.entry(day).or_default() += 1;
            if c.last.as_deref() < Some(timestamp.as_str()) {
                c.last = Some(timestamp);
            }
        }
    }
}

#[derive(Deserialize)]
struct Line {
    #[serde(rename = "type", default)]
    kind: String,
    timestamp: Option<String>,
    message: Option<Message>,
}

#[derive(Deserialize)]
struct Message {
    #[serde(default)]
    content: Value,
}

/// `(key, timestamp)` for each use in one transcript line. Only assistant tool calls and the user's
/// slash commands count; the same names inside tool results or request snapshots are ignored.
fn uses_in_line(line: &[u8]) -> Vec<(String, String)> {
    static MARKER: OnceLock<Regex> = OnceLock::new();
    let marker = MARKER.get_or_init(|| {
        Regex::new(r#""name":"Skill"|"subagent_type":"|<command-name>/|"name":"mcp__plugin_"#).unwrap()
    });
    if !marker.is_match(line) {
        return Vec::new();
    }
    let Ok(Line {
        kind,
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
                let name = block.get("name").and_then(Value::as_str).unwrap_or("");
                let input = |k: &str| block.pointer(&format!("/input/{k}")).and_then(Value::as_str);
                match name {
                    "Skill" => keys.extend(input("skill").map(|s| format!("skill:{s}"))),
                    "Agent" | "Task" => keys.extend(input("subagent_type").map(|s| format!("agent:{s}"))),
                    _ => {
                        if let Some(server) = name.strip_prefix("mcp__").and_then(|r| r.split("__").next())
                            && server.starts_with("plugin_")
                        {
                            keys.push(format!("mcp:{server}"));
                        }
                    }
                }
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
            {
                keys.push(format!("command:{}", name.trim()));
            }
        }
        _ => {}
    }
    keys.into_iter().map(|k| (k, ts.clone())).collect()
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
    use crate::model::Source;

    const SKILL: &str = r#"{"parentUuid":"x","type":"assistant","timestamp":"2026-10-23T06:43:02.042Z","message":{"content":[{"type":"tool_use","id":"toolu_1","name":"Skill","input":{"skill":"ui-ux-pro-max:ui-ux-pro-max","args":"x"}}]}}"#;
    const AGENT: &str = r#"{"type":"assistant","timestamp":"2026-10-24T01:00:00Z","message":{"content":[{"type":"tool_use","id":"t","name":"Agent","input":{"description":"d","subagent_type":"pm-skills:cs-pm-orchestrator"}}]},"wireToolInputs":{"t":{"subagent_type":"pm-skills:cs-pm-orchestrator"}}}"#;
    const MCP: &str = r#"{"type":"assistant","timestamp":"2026-10-24T02:00:00Z","message":{"content":[{"type":"tool_use","id":"t","name":"mcp__plugin_runpod_runpod__create-pod","input":{}}]}}"#;
    const COMMAND: &str = r#"{"type":"user","timestamp":"2026-10-24T03:00:00Z","message":{"role":"user","content":"<command-message>runpod:runpod-mcp</command-message>\n<command-name>/runpod:runpod-mcp</command-name>"}}"#;
    const MENTION: &str = r#"{"type":"user","timestamp":"2026-10-24T03:00:00Z","message":{"content":"Commands look like <command-name>/x</command-name>"}}"#;
    const SNAPSHOT: &str = r#"{"type":"api-request-shape","timestamp":"2026-10-24T03:00:00Z","shape":{"messages":[{"type":"tool_use","name":"Skill","input":{"skill":"dataviz"}}]}}"#;

    fn keys(line: &str) -> Vec<String> {
        uses_in_line(line.as_bytes()).into_iter().map(|(k, _)| k).collect()
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
        assert_eq!(state.counts.len(), 1);

        std::fs::write(&file, format!("{SKILL}\n{MCP}\n{MCP}\n")).unwrap();
        read_appended(&file, &mut state).unwrap();
        read_appended(&file, &mut state).unwrap(); // nothing new: no double counting
        let mcp = &state.counts["mcp:plugin_runpod_runpod"];
        assert_eq!(mcp.days.values().sum::<u32>(), 2);
        assert_eq!(mcp.last.as_deref(), Some("2026-10-24T02:00:00Z"));
        assert_eq!(
            state.counts["skill:ui-ux-pro-max:ui-ux-pro-max"]
                .days
                .values()
                .sum::<u32>(),
            1
        );
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
}
