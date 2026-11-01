//! The tray / menu bar icon, the window title, and update notifications. The UI owns the data
//! and sends a summary with `update_tray` whenever it changes; menu clicks that need the UI
//! come back to it as a `tray` event carrying the item's id.

use std::collections::HashMap;
use std::path::Path;

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
    if let Some(w) = app.get_webview_window("main") {
        w.set_title(&title(state.tokens))?;
    }
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return Ok(());
    };
    tray.set_menu(Some(menu(app, state)?))?;
    let tip = match state.updates.len() {
        0 => "Skillshelf".to_string(),
        1 => "Skillshelf: 1 update".to_string(),
        n => format!("Skillshelf: {n} updates"),
    };
    tray.set_tooltip(Some(tip))
}

fn title(tokens: Option<u32>) -> String {
    match tokens {
        Some(t) => format!("Skillshelf — ≈{} tokens per session", short_count(t)),
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
    let header = match s.updates.len() {
        0 => "No updates pending".to_string(),
        1 => "1 update pending".to_string(),
        n => format!("{n} updates pending"),
    };
    menu.append(&item("noop", &header, false)?)?;
    for (id, name) in s.updates.iter().take(LISTED) {
        menu.append(&item(&format!("review:{id}"), &format!("Update {name}…"), true)?)?;
    }
    if s.updates.len() > 1 {
        menu.append(&item("review-all", &format!("Update all {}…", s.updates.len()), true)?)?;
    }
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    let check = if s.checking { "Checking…" } else { "Check now" };
    menu.append(&item("check", check, !s.checking)?)?;
    if s.tokens.is_some() || s.unused.is_some() {
        menu.append(&PredefinedMenuItem::separator(app)?)?;
    }
    if let Some(t) = s.tokens {
        menu.append(&item(
            "overview",
            &format!("≈{} tokens per session", short_count(t)),
            true,
        )?)?;
    }
    if let Some(n) = s.unused.filter(|n| *n > 0) {
        let text = if n == 1 {
            "1 unused plugin".to_string()
        } else {
            format!("{n} unused plugins")
        };
        menu.append(&item("cleanup", &text, true)?)?;
    }
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    if let Some(v) = &s.app_update {
        menu.append(&item("app-update", &format!("Update Skillshelf ({v})…"), true)?)?;
    }
    menu.append(&item("show", "Show Skillshelf", true)?)?;
    menu.append(&item("quit", "Quit Skillshelf", true)?)?;
    Ok(menu)
}

/// Notifies about updates not announced before. While the window is in front the list already
/// shows them, so they count as announced without a notification.
pub fn announce(app: &AppHandle, items: &[Item], file: &Path) {
    let announced: HashMap<String, String> = crate::scan::read_json(file)
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();
    let (new, next) = fresh(items, &announced);
    if next != announced
        && let Ok(json) = serde_json::to_vec(&next)
    {
        let _ = std::fs::write(file, json);
    }
    let in_front = app
        .get_webview_window("main")
        .is_some_and(|w| w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false));
    if new.is_empty() || in_front {
        return;
    }
    let notify = |title: String, body: String| {
        let _ = app.notification().builder().title(title).body(body).show();
    };
    if new.len() <= 3 {
        for i in new {
            let body = match (&i.version, &i.latest) {
                (Some(v), Some(l)) => format!("{v} → {l}"),
                _ => "A new version is available.".into(),
            };
            notify(format!("Update available: {}", i.name), body);
        }
    } else {
        let names: Vec<&str> = new.iter().take(3).map(|i| i.name.as_str()).collect();
        notify(
            format!("{} updates available", new.len()),
            format!("{} and {} more", names.join(", "), new.len() - 3),
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
        assert_eq!(title(Some(48_400)), "Skillshelf — ≈48k tokens per session");
        assert_eq!(title(None), "Skillshelf");
    }
}
