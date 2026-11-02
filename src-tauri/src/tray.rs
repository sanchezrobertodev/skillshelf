//! The tray / menu bar icon, the window title, and update notifications. The UI owns the data
//! and sends a summary with `update_tray` whenever it changes; menu clicks that need the UI
//! come back to it as a `tray` event carrying the item's id.

use std::collections::HashMap;
use std::path::Path;
use std::sync::LazyLock;

use serde::Deserialize;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};
use tauri_plugin_notification::NotificationExt;

use crate::model::{Item, Status};

const TRAY_ID: &str = "main";
/// Pending updates listed by name; the rest are behind "Update all".
const LISTED: usize = 8;

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayState {
    /// `(item id, name)` of each pending update.
    pub updates: Vec<(String, String)>,
    pub checking: bool,
    /// Estimated tokens per session from everything that's on.
    pub tokens: Option<u32>,
    pub unused: Option<u32>,
    /// A newer Skillshelf version, or how many commits a clone is behind.
    pub app_update: Option<String>,
    /// The `tray.` texts in the UI's language.
    pub text: HashMap<String, String>,
}

/// The English texts from the UI's own file, for the menu built before the UI sends its language.
static EN: LazyLock<HashMap<String, String>> = LazyLock::new(|| {
    let all: HashMap<String, String> = serde_json::from_str(include_str!("../../src/i18n/en.json")).unwrap_or_default();
    all.into_iter().filter(|(k, _)| k.starts_with("tray.")).collect()
});

/// `tray.*` texts with `{name}` placeholders, falling back to English.
pub struct Text<'a>(pub &'a HashMap<String, String>);

impl Text<'_> {
    fn get(&self, key: &str, args: &[(&str, &str)]) -> String {
        let s = self.0.get(key).or_else(|| EN.get(key)).map_or(key, String::as_str);
        args.iter()
            .fold(s.to_string(), |s, (k, v)| s.replace(&format!("{{{k}}}"), v))
    }

    /// shortcut: `_one` for 1 and `_other` otherwise fits the shipped languages (French and Portuguese read fine with `_other` for 0); a language with more plural forms needs the UI to send them chosen.
    fn count(&self, key: &str, n: usize, args: &[(&str, &str)]) -> String {
        let form = if n == 1 { "one" } else { "other" };
        let n = n.to_string();
        let args: Vec<(&str, &str)> = std::iter::once(("count", n.as_str()))
            .chain(args.iter().copied())
            .collect();
        self.get(&format!("{key}_{form}"), &args)
    }
}

pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Creates the icon. Fails on Linux desktops without an AppIndicator host; then the window
/// closes normally instead of hiding.
pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let mut tray = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Skillshelf")
        .menu(&menu(app, &TrayState::default())?)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        })
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "quit" => app.exit(0),
            // Checking needs no window; everything else is shown in it.
            "check" => {
                let _ = app.emit("tray", "check");
            }
            id => {
                show_main(app);
                let _ = app.emit("tray", id);
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

pub fn has_tray(app: &AppHandle) -> bool {
    app.tray_by_id(TRAY_ID).is_some()
}

pub fn update(app: &AppHandle, state: &TrayState) -> tauri::Result<()> {
    let text = Text(&state.text);
    if let Some(w) = app.get_webview_window("main") {
        w.set_title(&title(&text, state.tokens))?;
    }
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return Ok(());
    };
    tray.set_menu(Some(menu(app, state)?))?;
    let tip = match state.updates.len() {
        0 => "Skillshelf".to_string(),
        n => text.count("tray.tooltip", n, &[]),
    };
    tray.set_tooltip(Some(tip))
}

fn title(text: &Text, tokens: Option<u32>) -> String {
    match tokens {
        Some(t) => text.get("tray.title", &[("tokens", &short_count(t))]),
        None => "Skillshelf".into(),
    }
}

/// 53271 → `53k`, 950 → `950`.
pub fn short_count(n: u32) -> String {
    if n >= 1000 {
        format!("{}k", (n + 500) / 1000)
    } else {
        n.to_string()
    }
}

fn menu(app: &AppHandle, s: &TrayState) -> tauri::Result<Menu<Wry>> {
    let menu = Menu::new(app)?;
    let item = |id: &str, text: &str, enabled: bool| MenuItem::with_id(app, id, text, enabled, None::<&str>);
    let t = Text(&s.text);
    let header = match s.updates.len() {
        0 => t.get("tray.none", &[]),
        n => t.count("tray.header", n, &[]),
    };
    menu.append(&item("noop", &header, false)?)?;
    for (id, name) in s.updates.iter().take(LISTED) {
        menu.append(&item(
            &format!("review:{id}"),
            &t.get("tray.update", &[("name", name)]),
            true,
        )?)?;
    }
    if s.updates.len() > 1 {
        let all = t.get("tray.updateAll", &[("count", &s.updates.len().to_string())]);
        menu.append(&item("review-all", &all, true)?)?;
    }
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    let check = t.get(if s.checking { "tray.checking" } else { "tray.check" }, &[]);
    menu.append(&item("check", &check, !s.checking)?)?;
    if s.tokens.is_some() || s.unused.is_some() {
        menu.append(&PredefinedMenuItem::separator(app)?)?;
    }
    if let Some(tokens) = s.tokens {
        let tokens = t.get("tray.tokens", &[("tokens", &short_count(tokens))]);
        menu.append(&item("overview", &tokens, true)?)?;
    }
    if let Some(n) = s.unused.filter(|n| *n > 0) {
        menu.append(&item("cleanup", &t.count("tray.unused", n as usize, &[]), true)?)?;
    }
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    if let Some(v) = &s.app_update {
        menu.append(&item("app-update", &t.get("tray.appUpdate", &[("version", v)]), true)?)?;
    }
    menu.append(&item("show", &t.get("tray.show", &[]), true)?)?;
    menu.append(&item("quit", &t.get("tray.quit", &[]), true)?)?;
    Ok(menu)
}

/// Notifies about updates not announced before. While the window is in front the list already
/// shows them, so they count as announced without a notification; with notifications off, too.
pub fn announce(app: &AppHandle, items: &[Item], file: &Path, text: &HashMap<String, String>, enabled: bool) {
    let announced: HashMap<String, String> = crate::scan::read_json(file)
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();
    let (new, next) = fresh(items, &announced);
    if next != announced
        && let Ok(json) = serde_json::to_vec(&next)
    {
        let _ = crate::settings::write_atomic(file, &json);
    }
    let in_front = app
        .get_webview_window("main")
        .is_some_and(|w| w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false));
    if new.is_empty() || in_front || !enabled {
        return;
    }
    let t = Text(text);
    let notify = |title: String, body: String| {
        let _ = app.notification().builder().title(title).body(body).show();
    };
    if new.len() <= 3 {
        for i in new {
            let body = match (&i.version, &i.latest) {
                (Some(v), Some(l)) => format!("{v} → {l}"),
                _ => t.get("tray.notifyNew", &[]),
            };
            notify(t.get("tray.notifyOne", &[("name", &i.name)]), body);
        }
    } else {
        let names: Vec<&str> = new.iter().take(3).map(|i| i.name.as_str()).collect();
        notify(
            t.get("tray.notifyMany", &[("count", &new.len().to_string())]),
            t.get(
                "tray.notifyManyBody",
                &[("names", &names.join(", ")), ("count", &(new.len() - 3).to_string())],
            ),
        );
    }
}

/// Updates whose `(id, latest)` wasn't announced yet, and the pending set to remember. Updates that
/// are no longer pending drop out, so a later version of the same item is announced again.
fn fresh<'a>(items: &'a [Item], announced: &HashMap<String, String>) -> (Vec<&'a Item>, HashMap<String, String>) {
    let pending: Vec<&Item> = items.iter().filter(|i| i.status == Status::UpdateAvailable).collect();
    let key = |i: &Item| i.latest.clone().unwrap_or_default();
    let new = pending
        .iter()
        .copied()
        .filter(|i| announced.get(&i.id) != Some(&key(i)))
        .collect();
    let next = pending.iter().map(|i| (i.id.clone(), key(i))).collect();
    (new, next)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Kind, Source};

    fn update(id: &str, latest: &str) -> Item {
        let mut i = Item::new(id.into(), Kind::Skill, Source::SkillsCli, id.into());
        i.status = Status::UpdateAvailable;
        i.latest = Some(latest.into());
        i
    }

    #[test]
    fn each_update_is_announced_once() {
        let items = vec![
            update("a", "#1"),
            update("b", "#2"),
            Item::new("c".into(), Kind::Skill, Source::Local, "c".into()),
        ];
        let (new, seen) = fresh(&items, &HashMap::new());
        assert_eq!(new.len(), 2);
        let (again, _) = fresh(&items, &seen);
        assert!(again.is_empty());

        let newer = vec![update("a", "#3"), update("b", "#2")];
        let (new, seen) = fresh(&newer, &seen);
        assert_eq!(new.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(), ["a"]);
        assert_eq!(seen.len(), 2);
    }

    #[test]
    fn counts_and_titles() {
        assert_eq!(short_count(53_271), "53k");
        assert_eq!(short_count(950), "950");
        let en = HashMap::new();
        assert_eq!(title(&Text(&en), Some(48_400)), "Skillshelf — ≈48k tokens per session");
        assert_eq!(title(&Text(&en), None), "Skillshelf");
        let es = HashMap::from([(
            "tray.header_other".to_string(),
            "{count} actualizaciones pendientes".to_string(),
        )]);
        assert_eq!(Text(&es).count("tray.header", 3, &[]), "3 actualizaciones pendientes");
        assert_eq!(Text(&es).count("tray.header", 1, &[]), "1 update pending");
    }
}
