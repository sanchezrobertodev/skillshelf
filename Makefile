# Local stand-in for the `test` job in .github/workflows/release.yml.
# Recipes are plain commands so they run under sh (macOS/Linux, Git Bash) and cmd.exe.

CARGO_MANIFEST := --manifest-path src-tauri/Cargo.toml

.PHONY: check install typecheck test lint fmt fmt-check dev build

## check: everything CI runs before bundling, plus clippy and rustfmt
check: typecheck fmt-check lint test

install:
	npm ci

typecheck:
	npm run typecheck

test:
	cargo test $(CARGO_MANIFEST)

lint:
	cargo clippy $(CARGO_MANIFEST) --all-targets -- -D warnings

fmt:
	cargo fmt $(CARGO_MANIFEST)

fmt-check:
	cargo fmt $(CARGO_MANIFEST) -- --check

dev:
	npm run tauri dev

## build: installers for the current OS (see README)
build:
	npm run tauri build
