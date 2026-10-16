//! Update / enable / disable / uninstall. Each action is a fixed argument list
//! for a known CLI; ids are validated before they reach a command line.

use std::path::PathBuf;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::model::{CheckInfo, Item, Kind, Source};
use crate::proc;

/// The `skills` CLI major version these flags were written against.
const SKILLS_CLI: &str = "skills@1";
const ACTION_TIMEOUT: Duration = Duration::from_secs(600);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Action {
    Update,
    Enable,
    Disable,
    Uninstall,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionRequest {
    pub item_id: String,
    pub action: Action,
    /// sha256 of a marketplace-declared install command the user has reviewed and accepted.
    pub accept_command: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum JobState {
    Queued,
    Running,
    Log,
    Success,
    Failed,
    NeedsConfirmation,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Confirm {
    pub command: String,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobEvent {
    pub job_id: u64,
    pub item_id: String,
    pub item_name: String,
    pub action: Action,
    pub state: JobState,
    pub line: Option<String>,
    pub message: Option<String>,
    pub confirm: Option<Confirm>,
}

#[derive(Debug, PartialEq)]
pub enum Plan {
    Cli {
        program: &'static str,
        args: Vec<String>,
        cwd: Option<PathBuf>,
    },
    Trash(PathBuf),
}

fn valid_plugin_id(s: &str) -> bool {
    s.contains('@') && s.chars().all(|c| c.is_ascii_alphanumeric() || "._-@".contains(c)) && !s.starts_with('-')
}

fn valid_skill_name(s: &str) -> bool {
    !s.is_empty() && !s.starts_with('-') && s.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))
}

pub fn plan(item: &Item, req: &ActionRequest) -> Result<Plan, String> {
    match (item.kind, item.source) {
        (Kind::Plugin, Source::Marketplace | Source::Synced) => plugin_plan(item, req),
        (Kind::Skill, Source::SkillsCli) => {
            let CheckInfo::SkillsCli { name, .. } = &item.check else {
                return Err("Missing skill install record".into());
            };
            if !valid_skill_name(name) {
                return Err(format!("Refusing unusual skill name `{name}`"));
            }
            let args: Vec<&str> = match req.action {
                Action::Update => vec!["--yes", SKILLS_CLI, "update", name, "-g", "-y"],
                // Only unlink from Claude Code; other agents that share the skill keep it.
                Action::Uninstall => vec!["--yes", SKILLS_CLI, "remove", name, "-g", "-a", "claude-code", "-y"],
                Action::Enable | Action::Disable => {
                    return Err("Skills can't be enabled or disabled individually".into());
                }
            };
            Ok(Plan::Cli {
                program: "npx",
                args: args.into_iter().map(String::from).collect(),
                cwd: None,
            })
        }
        (Kind::Skill, Source::Local | Source::Project) => match req.action {
            Action::Uninstall => {
                let path = PathBuf::from(item.path.as_deref().ok_or("Skill has no folder")?);
                if std::fs::symlink_metadata(&path).is_ok_and(|m| m.file_type().is_symlink()) {
                    return Err(
                        "This skill is a link to another folder; remove it with the tool that created it".into(),
                    );
                }
                if !path.join("SKILL.md").is_file() {
                    return Err("Folder no longer contains a SKILL.md".into());
                }
                Ok(Plan::Trash(path))
            }
            Action::Update => Err("No installer tracks this skill, so it can't be updated automatically".into()),
            _ => Err("Skills can't be enabled or disabled individually".into()),
        },
        _ => Err("Unsupported item".into()),
    }
}

fn plugin_plan(item: &Item, req: &ActionRequest) -> Result<Plan, String> {
    let CheckInfo::Plugin {
        plugin_id,
        scope,
        project_path,
        ..
    } = &item.check
    else {
        return Err("Missing plugin install record".into());
    };
    if !valid_plugin_id(plugin_id) {
        return Err(format!("Refusing unusual plugin id `{plugin_id}`"));
    }
    let synced = item.source == Source::Synced;
    if synced && matches!(req.action, Action::Update | Action::Uninstall) {
        return Err("Managed by your claude.ai organization".into());
    }

    let verb = match req.action {
        Action::Update => "update",
        Action::Enable => "enable",
        Action::Disable => "disable",
        Action::Uninstall => "uninstall",
    };
    let mut args = vec!["plugin".to_string(), verb.into(), plugin_id.clone(), "--json".into()];
    if matches!(scope.as_str(), "user" | "project" | "local") {
        args.extend(["-s".into(), scope.clone()]);
    }
    if req.action == Action::Update
        && let Some(sha) = &req.accept_command
    {
        if sha.len() != 64 || !sha.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err("Invalid command hash".into());
        }
        args.extend(["--accept-command".into(), sha.clone()]);
    }
    let cwd = project_path
        .clone()
        .filter(|_| matches!(scope.as_str(), "project" | "local"));
    Ok(Plan::Cli {
        program: "claude",
        args,
        cwd,
    })
}

pub enum Finished {
    Success(Option<String>),
    Failed(String),
    NeedsConfirmation(Confirm, Option<String>),
}

pub async fn execute(plan: Plan, mut on_line: impl FnMut(&str)) -> Finished {
    match plan {
        Plan::Trash(path) => match trash::delete(&path) {
            Ok(()) => Finished::Success(Some(format!("Moved {} to the trash", path.display()))),
            Err(e) => Finished::Failed(format!("Could not move to trash: {e}")),
        },
        Plan::Cli { program, args, cwd } => {
            let out = match proc::run_streaming(program, &args, cwd.as_deref(), ACTION_TIMEOUT, |l| {
                if !l.trim().is_empty() {
                    on_line(l)
                }
            })
            .await
            {
                Ok(o) => o,
                Err(e) => return Finished::Failed(e),
            };
            interpret(out.code, &out.stdout, &out.stderr)
        }
    }
}

/// Reads the result of a CLI run, including `--json` result lines from `claude plugin`.
pub fn interpret(code: Option<i32>, stdout: &str, stderr: &str) -> Finished {
    let json: Option<Value> = stdout
        .lines()
        .rev()
        .find_map(|l| serde_json::from_str::<Value>(l.trim()).ok().filter(Value::is_object));
    let message = json
        .as_ref()
        .and_then(|j| {
            ["message", "error", "status"]
                .iter()
                .find_map(|k| j.get(*k).and_then(Value::as_str))
        })
        .map(str::to_string);

    if let Some(shown) = json.as_ref().and_then(|j| j.get("shownCommand"))
        && code != Some(0)
        && let Some(sha) = shown.get("sha256").and_then(Value::as_str)
    {
        let command = ["command", "text", "display"]
            .iter()
            .find_map(|k| shown.get(*k).and_then(Value::as_str).map(str::to_string))
            .unwrap_or_else(|| serde_json::to_string_pretty(shown).unwrap_or_default());
        return Finished::NeedsConfirmation(
            Confirm {
                command,
                sha256: sha.to_string(),
            },
            message,
        );
    }

    let last = |s: &str| {
        s.lines()
            .rev()
            .map(str::trim)
            .find(|l| !l.is_empty())
            .map(str::to_string)
    };
    if code == Some(0) {
        Finished::Success(message.or_else(|| last(stdout)))
    } else {
        Finished::Failed(
            message
                .or_else(|| last(stderr))
                .or_else(|| last(stdout))
                .unwrap_or_else(|| format!("Exited with code {}", code.map_or("?".into(), |c| c.to_string()))),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plugin(scope: &str, source: Source) -> Item {
        let mut item = Item::new("plugin:x@m:user".into(), Kind::Plugin, source, "x".into());
        item.check = CheckInfo::Plugin {
            plugin_id: "x@m".into(),
            marketplace: "m".into(),
            name: "x".into(),
            installed_version: None,
            git_sha: None,
            install_path: None,
            scope: scope.into(),
            project_path: None,
        };
        item
    }

    fn req(action: Action) -> ActionRequest {
        ActionRequest {
            item_id: String::new(),
            action,
            accept_command: None,
        }
    }

    #[test]
    fn plugin_update_args() {
        let Plan::Cli { program, args, .. } = plan(&plugin("user", Source::Marketplace), &req(Action::Update)).unwrap()
        else {
            panic!()
        };
        assert_eq!(program, "claude");
        assert_eq!(args, ["plugin", "update", "x@m", "--json", "-s", "user"]);
    }

    #[test]
    fn synced_plugins_cannot_be_updated() {
        assert!(plan(&plugin("synced", Source::Synced), &req(Action::Update)).is_err());
        assert!(plan(&plugin("synced", Source::Synced), &req(Action::Disable)).is_ok());
    }

    #[test]
    fn rejects_bad_ids_and_hashes() {
        let mut item = plugin("user", Source::Marketplace);
        if let CheckInfo::Plugin { plugin_id, .. } = &mut item.check {
            *plugin_id = "x@m & calc".into();
        }
        assert!(plan(&item, &req(Action::Update)).is_err());
        let r = ActionRequest {
            accept_command: Some("nothex".into()),
            ..req(Action::Update)
        };
        assert!(plan(&plugin("user", Source::Marketplace), &r).is_err());
    }

    #[test]
    fn skills_cli_uninstall_only_unlinks_claude() {
        let mut item = Item::new("skill:a".into(), Kind::Skill, Source::SkillsCli, "a".into());
        item.check = CheckInfo::SkillsCli {
            name: "a".into(),
            repo: None,
            skill_path: "SKILL.md".into(),
            folder_hash: None,
        };
        let Plan::Cli { args, .. } = plan(&item, &req(Action::Uninstall)).unwrap() else {
            panic!()
        };
        assert!(args.windows(2).any(|w| w == ["-a", "claude-code"]));
    }

    #[test]
    fn interprets_results() {
        assert!(
            matches!(interpret(Some(0), "{\"message\":\"Updated\"}\n", ""), Finished::Success(Some(m)) if m == "Updated")
        );
        assert!(matches!(interpret(Some(1), "", "boom\n"), Finished::Failed(m) if m == "boom"));
        let needs = interpret(
            Some(1),
            "{\"shownCommand\":{\"sha256\":\"ab\",\"command\":\"curl x\"}}",
            "",
        );
        assert!(matches!(needs, Finished::NeedsConfirmation(c, _) if c.command == "curl x"));
    }
}
