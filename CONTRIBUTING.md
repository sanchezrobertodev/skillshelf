# Contributing to Skillshelf

Thanks for helping. Bug reports, translations, themes and code are all welcome.

## Report a bug or ask for a feature

Open an [issue](https://github.com/sanchezrobertodev/skillshelf/issues/new/choose). For a bug, say which OS and Skillshelf version you use (both are in **Settings → About**) and what you expected to happen. Security problems go through [SECURITY.md](SECURITY.md) instead.

## Set up

You need Node 22+, Rust (stable) and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS.

```bash
npm install
npm run tauri dev      # native window with the real backend
npm run dev            # browser only, with a mock backend (src/dev/mock.ts)
```

The browser mode is the quickest way to work on the UI. It reads `src/dev/snapshot.json` when that file exists; the README's **Develop** section explains how to make one from your own install.

## Before you open a pull request

Run `make check`. It runs the typecheck, the theme contrast check, `cargo fmt --check`, `cargo clippy -D warnings` and `cargo test`. CI runs the typecheck, the contrast check and the tests on every pull request. It also builds the installers on Windows, macOS and Linux when the pull request changes `src-tauri/`, `package.json`, `package-lock.json` or `.github/`.

- Keep a pull request to one change, and say in its description how you checked it.
- Add a line under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md) for anything a user would notice. That section becomes the release notes.
- Text on screen goes through the translation files (see below). Don't put English strings straight into components.
- Components use the semantic colour tokens (`bg-surface`, `text-muted`, `text-warn`…), never raw hex. [design-system/skillshelf/MASTER.md](design-system/skillshelf/MASTER.md) has the rules.
- New CLI calls go through `src-tauri/src/proc.rs`, with a timeout and no shell.

## Translations

Every piece of text the app shows lives in one JSON file per language in [`src/i18n/`](src/i18n/): `en.json` (English, the source) and `es.json` (Spanish). The tray menu and notifications use the same files.

- Keys are flat and grouped by screen: `"settings.language": "Language"`.
- `{name}` is a value the app fills in. Keep every placeholder from the English text, and don't translate what's inside the braces.
- Keys ending in `_one` / `_other` are plural forms, picked by the `count` value. If your language has more forms ([CLDR plural rules](https://www.unicode.org/cldr/charts/latest/supplemental/language_plural_rules.html)), add keys such as `_few` or `_many`; the app uses them when they exist.
- Keep product and tool names in English: Skillshelf, Claude Code, GitHub, MCP, and command names like `claude plugin install`.

To fix a translation, edit the JSON file and open a pull request.

To add a language:

1. Copy `src/i18n/en.json` to `src/i18n/<code>.json` (an ISO 639-1 code such as `fr` or `de`) and translate the values.
2. In [`src/i18n/index.ts`](src/i18n/index.ts), import the file and add it to `languages` (with the language's own name, such as `Français`) and to `dicts`.
3. Run `npm run typecheck` and `node scripts/i18n.mjs`. They fail if the new file is missing a key that `en.json` has, or a text lost one of its `{placeholders}`.
4. Run `npm run dev`, pick the language in **Settings → General → Language**, and look through each screen for text that's cut off.

## Themes

Themes are blocks of colour tokens in [`src/index.css`](src/index.css): one `[data-palette="name"]` block for light and one `[data-palette="name"][data-theme="dark"]` block for dark. Each block defines every token.

To add one, add both blocks, add the name to `palettes` in [`src/lib/prefs.ts`](src/lib/prefs.ts), and add a `palette.<name>` key to each language file. Then run `node scripts/contrast.mjs`: every text colour must reach 4.5:1 on the surfaces it's used on (7:1 for the high-contrast theme), and the script lists any pair that doesn't.

## Code of conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md). By taking part, you agree to it.

## License

Contributions are released under the [MIT License](LICENSE), like the rest of the project.
