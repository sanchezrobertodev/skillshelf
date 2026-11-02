# Changelog

All notable changes to Skillshelf are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

Each version's section is also its GitHub release notes and the "What's new" text the app shows before updating.

## [Unreleased]

## [0.5.0] - 2026-11-02

### Added

- Brazilian Portuguese, German, French and Japanese. If your computer uses one of them, Skillshelf now opens in it, unless you picked a language in **Settings → General → Language**. These are first translations, so corrections are welcome.

### Changed

- The Indigo theme is bluer, so it's easier to tell apart from the violet Workbench.

### Fixed

- Plugins that keep their skills, commands, agents or hooks outside the usual folders (named in their `plugin.json`) now show them and count those skills, commands and agents in their token cost. They get the **Mod** badge if they change Claude Code.
- A plugin installed in two projects now updates, turns on or off, and uninstalls in the project whose row you picked.
- Updating Skillshelf from a git clone on Windows no longer fails after the first update, and a working copy of the app stays in place while it builds.
- Stopping a job, or a job timing out, now also ends the programs it started.
- An update check and actions such as updates, uninstalls or turning plugins on or off no longer run at the same time. A check waits until the actions finish, and actions you start during a check wait for it to end.
- Uninstalling something during an update check no longer leaves it in the list.
- Clicking an action again while it waits no longer queues it twice.
- **Review updates** in the toolbar counts only updates Skillshelf can install.
- Versions such as `2.1` are now compared, so skills and plugins that use them show their updates.
- Skill changelogs use far fewer GitHub requests, so reviewing updates without a GitHub token runs out of requests much less often.
- Usage counts no longer count a resumed session's earlier uses again.
- Settings can no longer be lost when the app closes in the middle of saving them.
- Program output with characters that aren't UTF-8 no longer stops a job's log.
- An error shown for one item no longer stays on screen when you open another, and the review sheet starts fresh for a new set of updates.
- The usage graph names the right busiest day in time zones ahead of or behind UTC.

### Security

- A marketplace catalog could make the update check run a command on your computer through a crafted repository URL, ref or npm package name. Skillshelf now refuses those values.
- The update review could miss new or changed hooks and MCP servers. It now also flags any `.json` file in a plugin's `hooks` folder, the hook and MCP files its `plugin.json` names, and `.mcpb` and `.dxt` MCP bundles.

### Notes

- If you run Skillshelf from a git clone on Windows, the update to 0.5.0 still runs the old updater and can fail. If it does, quit Skillshelf, run `git pull --ff-only`, `npm ci` and `npm run tauri build -- --no-bundle` in the clone, then start `src-tauri/target/release/skillshelf.exe`.

## [0.4.0] - 2026-11-01

### Changed

- A new look for the default Workbench theme: violet with a violet-to-teal gradient on main buttons, a soft glow behind the window, and frosted cards. The other themes keep their flat style.
- The interface font is now Geist, and cards have rounder corners, in every theme.

## [0.3.0] - 2026-11-01

### Added

- **Settings** is now a screen of its own, with General, Appearance, Updates, Project folders and About sections. Changes apply right away.
- Spanish. Skillshelf follows your system language, or you can pick one in **Settings → General**. The tray menu and notifications use it too.
- Colour themes: Workbench (the current teal), Graphite, Indigo, Rose and High contrast, each in light and dark. Every theme's text meets WCAG contrast (7:1 for High contrast).
- Choose how often Skillshelf checks for updates: every day, every week, or only when you click **Check now**.
- Turn update notifications off.
- Start Skillshelf at login, hidden in the tray.
- Choose whether closing the window keeps Skillshelf in the tray or quits it.
- Links to the source code, issue tracker, changelog and license in **Settings → About**.
- CONTRIBUTING.md (including how to add a language or a theme), a security policy, a code of conduct, and issue and pull request templates.

### Changed

- Skill health messages and update risk flags are shown in your language.

## [0.2.0] - 2026-10-31

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
- **Overview**: pending updates, the estimated tokens per session with the five heaviest items, unused plugins, MCP server problems, skill health and skills that changed upstream. Each tile links to the screen or filtered list behind it.
- **Clean Up**: enabled plugins with no uses in 30 days (biggest first, turn off or uninstall in a batch), plugins with hooks, skills moved upstream (Reinstall) or removed upstream (with the commit that deleted them), and plugins your organization manages.
- **MCP Servers**: every server from `claude mcp list`, grouped by plugin, with its status and the reason when it fails. Only the host of each URL is shown. The check starts when you open the screen, because it starts every server.
- Usage: uses per skill and plugin in the last 30 days, counted on this computer from your Claude Code transcripts, which never leave it.
- Context cost: an estimate of the tokens each item adds to every session, with a breakdown per skill, command and agent.
- Skill health checks: missing or broken frontmatter, missing or too-long descriptions, missing or replaced `skills` CLI links, and duplicate names. Problems show as a badge in the list and in the details.
- A **Mod** badge on plugins that change Claude Code itself.
- The Library gets **Cost** and **Uses** columns (shown when the window is wide enough) and **Show only** filters: Unused, Has issues, Has hooks and Mods.
- The details panel adds the cost breakdown, a 30-day usage chart, a SKILL.md or README preview, the last action's output, and the commit your installed version matches.
- **Reinstall** for skills that moved upstream, in the details panel, the right-click menu and Clean Up.
- Updates for a copy built from its git clone. Skillshelf checks the clone's default branch on launch and once a day, and **Update & restart** runs `git pull`, `npm ci` and a release build, then reopens. It refuses, and says why, when the clone is on another branch, has commits origin doesn't, or has uncommitted changes. Installed copies keep using signed releases.

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

[Unreleased]: https://github.com/sanchezrobertodev/skillshelf/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/sanchezrobertodev/skillshelf/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/sanchezrobertodev/skillshelf/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/sanchezrobertodev/skillshelf/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/sanchezrobertodev/skillshelf/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/sanchezrobertodev/skillshelf/releases/tag/v0.1.0
