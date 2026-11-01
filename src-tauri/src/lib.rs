mod actions;
mod cost;
mod health;
mod mcp;
mod model;
mod paths;
mod proc;
mod scan;
mod settings;
mod tray;
mod updates;
mod usage;

use std::collections::HashMap;
use std::io::Read;
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use serde::Serialize;
#[cfg(target_os = "macos")]
use tauri::RunEvent;
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use tauri_plugin_opener::OpenerExt;

use actions::{ActionRequest, Finished, JobEvent, JobState, LastRun};
use model::{CheckInfo, CheckResult, Item, Kind, ScanResult, now_ms};
use settings::Settings;

struct AppState {
    items: Mutex<Vec<Item>>,
    settings: Mutex<Settings>,
    settings_file: PathBuf,
    /// Serializes actions: the CLIs share lock files.
    action_lock: tokio::sync::Mutex<()>,
    /// One usage index run at a time: they share the cache file.
    usage_lock: tokio::sync::Mutex<()>,
    next_job: AtomicU64,
    last_runs: Mutex<HashMap<String, LastRun>>,
    last_runs_file: PathBuf,
    /// Bumped by Stop: jobs queued under an older value are cancelled.
    cancel: tokio::sync::watch::Sender<u64>,
    /// When the last update check finished (ms), or launch time before the first, for the daily check.
    last_check: AtomicU64,
    /// Updates already announced, so each gets one notification.
    announced_file: PathBuf,
}

impl AppState {
    fn item(&self, id: &str) -> Result<Item, String> {
        self.items
            .lock()
            .unwrap()
            .iter()
            .find(|i| i.id == id)
            .cloned()
            .ok_or_else(|| format!("Unknown item `{id}`. Rescan and try again."))
    }

    fn remember_run(&self, item_id: &str, run: LastRun) {
        let mut runs = self.last_runs.lock().unwrap();
        runs.insert(item_id.to_string(), run);
        if let Ok(json) = serde_json::to_vec(&*runs) {
            let _ = std::fs::write(&self.last_runs_file, json);
        }
    }
}

#[tauri::command]
async fn scan(state: State<'_, AppState>) -> Result<ScanResult, String> {
    let settings = state.settings.lock().unwrap().clone();
    let result = scan::scan_all(&settings).await;
    *state.items.lock().unwrap() = result.items.clone();
    Ok(result)
}

#[tauri::command]
async fn check_updates(app: AppHandle, state: State<'_, AppState>) -> Result<CheckResult, String> {
    let items = state.items.lock().unwrap().clone();
    let result = updates::check_all(items).await;
    *state.items.lock().unwrap() = result.items.clone();
    state.last_check.store(now_ms(), Ordering::Relaxed);
    tray::announce(&app, &result.items, &state.announced_file);
    Ok(result)
}

/// Cancels the running job and skips every job queued so far.
#[tauri::command]
fn stop_actions(state: State<'_, AppState>) {
    state.cancel.send_modify(|g| *g += 1);
}

/// The UI's summary for the tray menu and the window title.
#[tauri::command]
fn update_tray(app: AppHandle, summary: tray::TrayState) -> Result<(), String> {
    tray::update(&app, &summary).map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct JobInfo {
    job_id: u64,
    item_id: String,
}

#[tauri::command]
async fn run_actions(
    app: AppHandle,
    state: State<'_, AppState>,
    requests: Vec<ActionRequest>,
) -> Result<Vec<JobInfo>, String> {
    let mut jobs = Vec::new();
    for req in requests {
        let mut item = state.item(&req.item_id)?;
        let job_id = state.next_job.fetch_add(1, Ordering::Relaxed);
        let event = JobEvent {
            job_id,
            item_id: item.id.clone(),
            item_name: item.name.clone(),
            action: req.action,
            state: JobState::Queued,
            line: None,
            message: None,
            confirm: None,
        };
        let _ = app.emit("job", &event);
        jobs.push(JobInfo {
            job_id,
            item_id: item.id.clone(),
        });

        let generation = *state.cancel.borrow();
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let state = app.state::<AppState>();
            let _guard = state.action_lock.lock().await;
            let mut stop = state.cancel.subscribe();
            // The data folder may have filled since the scan or while this job waited for the lock;
            // decide --keep-data on what's there now.
            if let CheckInfo::Plugin { plugin_id, .. } = &item.check {
                item.data_bytes = paths::plugin_data_size(plugin_id);
            }
            let plan = actions::plan(&item, &req);
            let emit = |state: JobState, line: Option<String>, message: Option<String>, confirm| {
                let _ = app.emit(
                    "job",
                    JobEvent {
                        state,
                        line,
                        message,
                        confirm,
                        ..event.clone()
                    },
                );
            };
            let mut lines = Vec::new();
            let finished = match plan {
                _ if *stop.borrow() != generation => None,
                Ok(plan) => {
                    emit(JobState::Running, None, None, None);
                    let run = actions::execute(plan, |l| {
                        lines.push(l.to_string());
                        emit(JobState::Log, Some(l.to_string()), None, None)
                    });
                    // Dropping the run kills its process (kill_on_drop).
                    tokio::select! {
                        f = run => Some(f),
                        _ = stop.wait_for(|g| *g != generation) => None,
                    }
                }
                Err(e) => Some(Finished::Failed(e)),
            };
            let (job_state, message, confirm) = match finished {
                Some(Finished::Success(m)) => (JobState::Success, m, None),
                Some(Finished::Failed(m)) => (JobState::Failed, Some(m), None),
                Some(Finished::NeedsConfirmation(c, m)) => (JobState::NeedsConfirmation, m, Some(c)),
                None => (JobState::Cancelled, Some("Stopped".to_string()), None),
            };
            lines.drain(..lines.len().saturating_sub(actions::MAX_LOG_LINES));
            state.remember_run(
                &event.item_id,
                LastRun {
                    action: event.action,
                    state: job_state,
                    message: message.clone(),
                    lines,
                    finished_at: now_ms(),
                },
            );
            emit(job_state, None, message, confirm);
        });
    }
    Ok(jobs)
}

#[tauri::command]
fn open_item_folder(app: AppHandle, state: State<'_, AppState>, item_id: String) -> Result<(), String> {
    let item = state.item(&item_id)?;
    let path = item.path.ok_or("This item has no folder")?;
    app.opener().open_path(path, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_item_repo(app: AppHandle, state: State<'_, AppState>, item_id: String) -> Result<(), String> {
    let item = state.item(&item_id)?;
    let url = item.repo_url.ok_or("This item has no source repository")?;
    if !url.starts_with("https://") {
        return Err("Only https links can be opened".into());
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

/// What changed between the installed and the latest version. Fetched when the user opens an item.
#[tauri::command]
async fn item_changelog(state: State<'_, AppState>, item_id: String) -> Result<updates::changelog::Changelog, String> {
    let item = state.item(&item_id)?;
    updates::changelog::for_item(&item).await
}

#[tauri::command]
fn open_changelog_link(app: AppHandle, state: State<'_, AppState>, item_id: String, url: String) -> Result<(), String> {
    // The commit that deleted a skill upstream comes from the update check, not a changelog.
    let removed_in = state
        .item(&item_id)
        .ok()
        .and_then(|i| i.upstream?.commit?.url)
        .is_some_and(|u| u == url);
    if !url.starts_with("https://") || !(removed_in || updates::changelog::is_known_link(&item_id, &url)) {
        return Err("Only links from this item's changelog can be opened".into());
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Readme {
    file: String,
    /// Markdown, without the front matter block.
    text: String,
    truncated: bool,
}

/// SKILL.md for skills, README.md for plugins, from the item's own folder. At most 200 KB.
#[tauri::command]
fn item_readme(state: State<'_, AppState>, item_id: String) -> Result<Option<Readme>, String> {
    const MAX: usize = 200 * 1024;
    let item = state.item(&item_id)?;
    let Some(dir) = item.path.map(PathBuf::from) else {
        return Ok(None);
    };
    let names: &[&str] = match item.kind {
        Kind::Skill => &["SKILL.md"],
        Kind::Plugin => &["README.md", "readme.md", "Readme.md"],
    };
    let Some(path) = names.iter().map(|n| dir.join(n)).find(|p| p.is_file()) else {
        return Ok(None);
    };
    let mut bytes = Vec::new();
    std::fs::File::open(&path)
        .and_then(|f| f.take(MAX as u64 + 1).read_to_end(&mut bytes))
        .map_err(|e| format!("Could not read {}: {e}", path.display()))?;
    let truncated = bytes.len() > MAX;
    bytes.truncate(MAX);
    let text = String::from_utf8_lossy(&bytes);
    Ok(Some(Readme {
        file: path.file_name().unwrap_or_default().to_string_lossy().into_owned(),
        text: scan::without_front_matter(&text).to_string(),
        truncated,
    }))
}

/// The last finished job's output per item, kept across restarts.
#[tauri::command]
fn last_runs(state: State<'_, AppState>) -> HashMap<String, LastRun> {
    state.last_runs.lock().unwrap().clone()
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UsageProgress {
    read: u64,
    total: u64,
}

/// Counts uses from the local transcripts (only what was appended since the last run).
/// Emits `usage-progress` while it reads.
#[tauri::command]
async fn usage(app: AppHandle, state: State<'_, AppState>) -> Result<usage::UsageReport, String> {
    let _guard = state.usage_lock.lock().await;
    let items = state.items.lock().unwrap().clone();
    let cache = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("usage-index.json");
    tauri::async_runtime::spawn_blocking(move || {
        usage::report(&items, &cache, |read, total| {
            let _ = app.emit("usage-progress", UsageProgress { read, total });
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Connects to every MCP server through `claude mcp list` (30–60 seconds).
#[tauri::command]
async fn mcp_status() -> Result<mcp::McpReport, String> {
    mcp::status().await
}

#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> Settings {
    state.settings.lock().unwrap().clone()
}

#[tauri::command]
fn save_settings(state: State<'_, AppState>, settings: Settings) -> Result<(), String> {
    settings.save(&state.settings_file)?;
    *state.settings.lock().unwrap() = settings;
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Environment {
    claude_dir: String,
    claude: Option<String>,
    npx: Option<String>,
    git: Option<String>,
    gh: Option<String>,
    os: &'static str,
    version: &'static str,
}

#[tauri::command]
fn environment() -> Environment {
    let find = |p: &str| proc::resolve(p).map(|p| p.display().to_string());
    Environment {
        claude_dir: paths::claude_dir().display().to_string(),
        claude: find("claude"),
        npx: find("npx"),
        git: find("git"),
        gh: find("gh"),
        os: std::env::consts::OS,
        version: env!("CARGO_PKG_VERSION"),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // GUI apps on macOS/Linux don't inherit the login shell's PATH (where claude/npx live).
    #[cfg(not(windows))]
    let _ = fix_path_env::fix();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        // With a tray icon, closing the window hides it so daily checks keep running. Quit from the tray.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event
                && tray::has_tray(window.app_handle())
            {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(|app| {
            let settings_file = app.path().app_config_dir()?.join("settings.json");
            let data_dir = app.path().app_data_dir()?;
            let _ = std::fs::create_dir_all(&data_dir);
            let last_runs_file = data_dir.join("last-runs.json");
            let announced_file = data_dir.join("announced.json");
            let last_runs = scan::read_json(&last_runs_file)
                .and_then(|v| serde_json::from_value(v).ok())
                .unwrap_or_default();
            app.manage(AppState {
                items: Mutex::new(Vec::new()),
                settings: Mutex::new(Settings::load(&settings_file)),
                settings_file,
                action_lock: tokio::sync::Mutex::new(()),
                usage_lock: tokio::sync::Mutex::new(()),
                next_job: AtomicU64::new(1),
                last_runs: Mutex::new(last_runs),
                last_runs_file,
                cancel: tokio::sync::watch::channel(0).0,
                // Counting from launch, auto-check turned on later still gets a check within a day.
                last_check: AtomicU64::new(now_ms()),
                announced_file,
            });
            if let Err(e) = tray::create(app.handle()) {
                eprintln!("No tray icon ({e}); closing the window will quit.");
            }
            daily_checks(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            scan,
            check_updates,
            run_actions,
            open_item_folder,
            open_item_repo,
            item_changelog,
            open_changelog_link,
            mcp_status,
            usage,
            item_readme,
            last_runs,
            stop_actions,
            update_tray,
            get_settings,
            save_settings,
            environment
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {
            // macOS: clicking the Dock icon brings the hidden window back.
            #[cfg(target_os = "macos")]
            if let RunEvent::Reopen { .. } = _event {
                tray::show_main(_app);
            }
        });
}

/// Asks the UI to rescan and check once a day after the last check. Hourly ticks, compared with the
/// wall clock, so a sleeping laptop catches up when it wakes.
fn daily_checks(app: AppHandle) {
    const DAY_MS: u64 = 24 * 60 * 60 * 1000;
    tauri::async_runtime::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(60 * 60));
        loop {
            tick.tick().await;
            let state = app.state::<AppState>();
            let last = state.last_check.load(Ordering::Relaxed);
            let auto = state.settings.lock().unwrap().auto_check;
            if auto && now_ms().saturating_sub(last) >= DAY_MS {
                let _ = app.emit("scheduled-check", ());
            }
        }
    });
}

#[cfg(test)]
mod smoke {
    /// Scans and checks this machine's real install. Run with `cargo test real_machine -- --ignored --nocapture`.
    #[tokio::test]
    #[ignore]
    async fn real_machine() {
        let scanned = crate::scan::scan_all(&crate::settings::Settings::default()).await;
        println!("warnings: {:?}", scanned.warnings);
        let checked = crate::updates::check_all(scanned.items).await;
        println!("check warnings: {:?}", checked.warnings);
        for i in &checked.items {
            println!(
                "{:?} {:?} {:<40} {:<16} -> {:<16} {:?} {}",
                i.kind,
                i.source,
                i.name,
                i.version.clone().unwrap_or_default(),
                i.latest.clone().unwrap_or_default(),
                i.status,
                i.status_detail.clone().unwrap_or_default()
            );
        }
        println!("total {}", checked.items.len());
        // Snapshot for the browser-only dev mock (src/dev/), with the home folder replaced by `~`.
        if let Ok(out) = std::env::var("SKILLSHELF_DUMP") {
            let home = crate::paths::home().display().to_string();
            let json = serde_json::to_string_pretty(&checked).unwrap();
            let json = json.replace(&home.replace('\\', "\\\\"), "~").replace(&home, "~");
            std::fs::write(out, json).unwrap();
        }
    }
}
