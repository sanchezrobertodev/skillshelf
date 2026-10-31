# Changelog

All notable changes to Skillshelf are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

Each version's section is also its GitHub release notes and the "What's new" text the app shows before updating.

## [Unreleased]

### Added

- In-app updates. Skillshelf checks GitHub Releases for a new version on launch, shows what's new, and installs it with **Install & restart**. Updates are signed and verified before they install. You can also check from **Settings → App updates**.
- This changelog.
- **What changed** for skills and plugins with an update: the item's release notes and the commits since your installed version, shown in its details.
- Skills that moved or were deleted upstream now show as **Moved upstream** or **Removed upstream** instead of Unknown.
- Skills installed with the `skills` CLI whose link in `~/.claude/skills` has gone missing now appear in the list. Before, they were hidden, even though Claude Code doesn't load them.
- A tray (menu bar) icon. Its menu lists pending updates, **Check now**, the estimated tokens per session and unused plugins. Closing the window hides Skillshelf to the tray so checks keep running; quit from the tray menu.
- Daily update checks while Skillshelf runs, and a notification for each new update, shown once. More than 3 new updates get one summary notification.
- An **Update** button and an **Enabled** switch on each row, and a right-click menu (or Shift+F10) with Update, Turn on/off, Open folder, Open repo and Uninstall. It acts on the whole selection when you right-click a selected row.
- **Stop** in Activity: cancels the running action and skips the queued ones. Batches show their progress, for example "3 of 9".
- The window title shows the estimated tokens every session starts with.

### Changed

- New look ("Workbench"): a navigation rail, a soft tinted window with the list and details on cards, teal for actions and orange only for updates. Light and dark themes both meet WCAG AA contrast.
- Updates now open a review first. Untick anything to skip it, see the commits since your version, and look for flags on changes that run without asking: new hooks, MCP servers, scripts or allowed tools. Hover or focus a flag to see the files.
- What changed for a `skills` CLI skill now starts from the exact version you have, found by matching the skill's files, instead of from its install date.
- Uninstalling a plugin keeps its saved data (settings, caches, downloads) unless you tick **Also delete saved data** in the confirmation. The option only appears when the plugin has data. Before, the data was always deleted.

### Fixed

- Dialogs now put focus on their main button instead of **Close**.
- A skill in a very large repo no longer shows as removed upstream when GitHub can't list the repo and the fallback lookup fails. It now says why it couldn't be checked.

### Notes

- Skillshelf 0.1.0 can't update itself, so install the next version by hand once. Updates after that are automatic.
- On Linux, only the AppImage updates itself. If you installed the `.deb` or `.rpm`, install the new package to update.

## [0.1.0] - 2026-10-17

First release of Skillshelf, a desktop app for the skills and plugins you've installed for Claude Code. It runs on Windows, macOS and Linux.

### Added

- One list for marketplace plugins, plugins your claude.ai organization syncs to you, skills installed with the `skills` CLI, hand-made skills in `~/.claude/skills`, and skills in project folders you add.
- Update checks against each item's upstream source: marketplace catalogs (semver, git commit or file comparison) and GitHub for `skills` CLI skills.
- Update one item, a selection, or everything with **Update all**.
- Filter, sort and search by type, status, source, marketplace/repo and on/off state.
- Enable/disable plugins, uninstall items (always with a confirmation), and open an item's folder or source repo.

[Unreleased]: https://github.com/sanchezrobertodev/skillshelf/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/sanchezrobertodev/skillshelf/releases/tag/v0.1.0
