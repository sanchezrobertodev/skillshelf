# Changelog

All notable changes to Skillshelf are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

Each version's section is also its GitHub release notes and the "What's new" text the app shows before updating.

## [Unreleased]

### Added

- In-app updates. Skillshelf checks GitHub Releases for a new version on launch, shows what's new, and installs it with **Install & restart**. Updates are signed and verified before they install. You can also check from **Settings → App updates**.
- This changelog.
- **What changed** for skills and plugins with an update: the item's release notes and the commits since your installed version, shown in its details.

### Changed

- Updates now ask for confirmation first, with a short summary of what's new for each item.

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
