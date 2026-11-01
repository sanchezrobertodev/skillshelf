//! MCP server health from `claude mcp list`, which has no JSON output, so its lines are parsed.
//! URLs are cut down to their host and commands to their program name here, before anything
//! reaches the UI, so tokens in paths, queries or arguments never leave this module.

use std::sync::OnceLock;
use std::time::Duration;

use regex::Regex;
use serde::Serialize;

use crate::model::now_ms;
use crate::{paths, proc};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum McpState {
    Connected,
    NeedsAuth,
    Failed,
    NotConfigured,
    Pending,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServer {
    /// The plugin that ships it (`plugin:<plugin>:<server>`).
    pub plugin: Option<String>,
    /// A connector from claude.ai (`claude.ai <name>`).
    pub claude_ai: bool,
    pub name: String,
    /// The URL's host, or the command's program name.
    pub target: Option<String>,
    /// HTTP | SSE; `None` for local commands.
    pub transport: Option<String>,
    pub state: McpState,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpReport {
    pub servers: Vec<McpServer>,
    pub checked_at: u64,
}

/// The CLI connects to every server, so this takes 30–60 seconds.
pub async fn status() -> Result<McpReport, String> {
    let out = proc::run(
        "claude",
        &["mcp", "list"],
        Some(&paths::home()),
        Duration::from_secs(180),
    )
    .await?;
    let servers = parse(&out.stdout);
    if servers.is_empty() && !out.success() {
        return Err(format!("`claude mcp list` failed: {}", out.stderr.trim()));
    }
    Ok(McpReport {
        servers,
        checked_at: now_ms(),
    })
}

/// `<name>: <target> [(TRANSPORT)] - <icon> <status>[ — <reason>]`, one server per line.
pub fn parse(out: &str) -> Vec<McpServer> {
    static LINE: OnceLock<Regex> = OnceLock::new();
    let line = LINE.get_or_init(|| {
        Regex::new(r"^(?P<name>.+?): (?P<target>.*?)(?: \((?P<transport>[A-Za-z]+)\))? - \S+ (?P<status>.+)$").unwrap()
    });
    out.lines()
        .filter_map(|l| line.captures(l.trim_end()))
        .map(|c| {
            let full = &c["name"];
            let (plugin, claude_ai, name) = match full.strip_prefix("plugin:").and_then(|r| r.split_once(':')) {
                Some((p, s)) => (Some(p.to_string()), false, s.to_string()),
                None => match full.strip_prefix("claude.ai ") {
                    Some(s) => (None, true, s.to_string()),
                    None => (None, false, full.to_string()),
                },
            };
            let (status, reason) = match c["status"].split_once(" — ") {
                Some((s, r)) => (s, Some(hosts_only(r))),
                None => (&c["status"], None),
            };
            let lower = status.to_lowercase();
            let state = if lower.starts_with("connected") {
                McpState::Connected
            } else if lower.contains("auth") {
                McpState::NeedsAuth
            } else if lower.starts_with("failed") {
                McpState::Failed
            } else if lower.contains("not configured") {
                McpState::NotConfigured
            } else if lower.contains("pending") || lower.contains("approv") {
                McpState::Pending
            } else {
                McpState::Unknown
            };
            McpServer {
                plugin,
                claude_ai,
                name,
                target: target(c["target"].trim()),
                transport: c.name("transport").map(|t| t.as_str().to_uppercase()),
                reason: if state == McpState::Unknown {
                    Some(hosts_only(status))
                } else {
                    reason
                },
                state,
            }
        })
        .collect()
}

fn host(url: &str) -> Option<String> {
    reqwest::Url::parse(url).ok()?.host_str().map(str::to_string)
}

/// A URL becomes its host; a command becomes its program name, without its path or arguments.
fn target(t: &str) -> Option<String> {
    if t.is_empty() {
        return None;
    }
    if t.starts_with("http://") || t.starts_with("https://") {
        return host(t);
    }
    // `C:\Program Files\nodejs\node.exe script.mjs`: the program ends at `.exe`, not at the first space.
    let lower = t.to_ascii_lowercase();
    let program = match lower.find(".exe") {
        Some(i) => &t[..i],
        None => t.split_whitespace().next().unwrap_or(t),
    };
    program.rsplit(['\\', '/']).next().map(str::to_string)
}

fn hosts_only(text: &str) -> String {
    static URL: OnceLock<Regex> = OnceLock::new();
    let url = URL.get_or_init(|| Regex::new(r"https?://[^\s]+").unwrap());
    url.replace_all(text, |c: &regex::Captures| {
        host(&c[0]).unwrap_or_else(|| "a URL".into())
    })
    .into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Real `claude mcp list` output, with the URL paths shortened and one token added to check redaction.
    const OUTPUT: &str = "Checking MCP server health…

claude.ai Claude Docs: https://api.anthropic.com/mcp/docs?token=secret - ✔ Connected
plugin:runpod:runpod: https://mcp.getrunpod.io/ (HTTP) - ✔ Connected
plugin:pm-skills:atlassian: https://mcp.atlassian.com/v1/sse (SSE) - ! Needs authentication
plugin:pdf-viewer:pdf: npx -y @modelcontextprotocol/server-pdf --stdio - ✔ Connected
plugin:design:google calendar:  (HTTP) - - Not configured
plugin:vgv-ai-flutter-plugin:very-good-cli: very_good mcp - ✘ Failed to connect — CONNECTION_CLOSED: Connection closed
plugin:data:definite: https://api.definite.app/mcp (HTTP) - ✘ Failed to connect — MCP endpoint not found at https://api.definite.app./mcp/v1. Check the URL in your MCP config.
rea: C:\\Program Files\\nodejs\\node.exe C:\\Users\\me\\rea.mjs mcp - ✔ Connected
blender: uvx blender-mcp - ⏸ Pending approval
";

    #[test]
    fn parses_real_mcp_list_lines() {
        let s = parse(OUTPUT);
        assert_eq!(s.len(), 9);

        assert!(s[0].claude_ai && s[0].plugin.is_none());
        assert_eq!(
            (s[0].name.as_str(), s[0].target.as_deref()),
            ("Claude Docs", Some("api.anthropic.com"))
        );
        assert_eq!(s[0].state, McpState::Connected);

        assert_eq!(s[1].plugin.as_deref(), Some("runpod"));
        assert_eq!(s[1].transport.as_deref(), Some("HTTP"));
        assert_eq!(s[2].state, McpState::NeedsAuth);
        assert_eq!(s[3].target.as_deref(), Some("npx"));

        assert_eq!(s[4].name, "google calendar");
        assert_eq!((s[4].target.as_deref(), s[4].state), (None, McpState::NotConfigured));

        assert_eq!(s[5].state, McpState::Failed);
        assert_eq!(s[5].reason.as_deref(), Some("CONNECTION_CLOSED: Connection closed"));
        assert_eq!(
            s[6].reason.as_deref(),
            Some("MCP endpoint not found at api.definite.app. Check the URL in your MCP config.")
        );

        assert_eq!((s[7].plugin.as_deref(), s[7].name.as_str()), (None, "rea"));
        assert_eq!(s[7].target.as_deref(), Some("node"));
        assert_eq!(s[8].state, McpState::Pending);
    }

    #[test]
    fn nothing_but_hosts_reaches_the_ui() {
        let json = serde_json::to_string(&parse(OUTPUT)).unwrap();
        for leak in ["token=secret", "/mcp", "rea.mjs", "Users", "/v1"] {
            assert!(!json.contains(leak), "{leak} leaked: {json}");
        }
    }
}
