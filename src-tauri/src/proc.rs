//! Runs the external CLIs (claude, npx, git, gh) without a shell and without
//! flashing console windows on Windows.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

#[derive(Debug, Clone)]
pub struct Output {
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

impl Output {
    pub fn success(&self) -> bool {
        self.code == Some(0)
    }
}

pub fn resolve(program: &str) -> Option<PathBuf> {
    which::which(program).ok()
}

fn command(program: &str, args: &[String], cwd: Option<&Path>) -> Result<Command, String> {
    let exe = resolve(program).ok_or_else(|| format!("`{program}` was not found on PATH"))?;
    let mut cmd = Command::new(exe);
    cmd.args(args)
        .env("NO_COLOR", "1")
        .env("FORCE_COLOR", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    Ok(cmd)
}

pub async fn run(program: &str, args: &[&str], cwd: Option<&Path>, timeout: Duration) -> Result<Output, String> {
    run_streaming(program, &to_owned(args), cwd, timeout, |_| {}).await
}

/// Runs a command and calls `on_line` for every stdout/stderr line as it arrives.
pub async fn run_streaming(
    program: &str,
    args: &[String],
    cwd: Option<&Path>,
    timeout: Duration,
    mut on_line: impl FnMut(&str),
) -> Result<Output, String> {
    let mut child = command(program, args, cwd)?
        .spawn()
        .map_err(|e| format!("failed to start `{program}`: {e}"))?;

    let mut out_lines = BufReader::new(child.stdout.take().expect("piped stdout")).lines();
    let mut err_lines = BufReader::new(child.stderr.take().expect("piped stderr")).lines();
    let mut stdout = String::new();
    let mut stderr = String::new();

    let work = async {
        let (mut out_done, mut err_done) = (false, false);
        while !(out_done && err_done) {
            tokio::select! {
                line = out_lines.next_line(), if !out_done => match line {
                    Ok(Some(l)) => { let l = strip_ansi(&l); on_line(&l); stdout.push_str(&l); stdout.push('\n'); }
                    _ => out_done = true,
                },
                line = err_lines.next_line(), if !err_done => match line {
                    Ok(Some(l)) => { let l = strip_ansi(&l); on_line(&l); stderr.push_str(&l); stderr.push('\n'); }
                    _ => err_done = true,
                },
            }
        }
        child.wait().await
    };

    match tokio::time::timeout(timeout, work).await {
        Ok(Ok(status)) => Ok(Output {
            code: status.code(),
            stdout,
            stderr,
        }),
        Ok(Err(e)) => Err(format!("`{program}` failed: {e}")),
        Err(_) => Err(format!("`{program}` timed out after {}s", timeout.as_secs())),
    }
}

fn to_owned(args: &[&str]) -> Vec<String> {
    args.iter().map(|s| s.to_string()).collect()
}

/// Removes ANSI escape sequences (colors, cursor moves, spinners) from CLI output.
pub fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            match chars.peek() {
                Some('[') => {
                    chars.next();
                    for c in chars.by_ref() {
                        if ('@'..='~').contains(&c) {
                            break;
                        }
                    }
                }
                Some(']') => {
                    chars.next();
                    while let Some(c) = chars.next() {
                        if c == '\u{7}' || (c == '\u{1b}' && chars.peek() == Some(&'\\')) {
                            break;
                        }
                    }
                }
                _ => {}
            }
        } else if c != '\r' {
            out.push(c);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_color_codes() {
        assert_eq!(strip_ansi("\u{1b}[1mUsage:\u{1b}[0m skills"), "Usage: skills");
        assert_eq!(strip_ansi("\u{1b}[38;5;102m$\u{1b}[0m x\r"), "$ x");
    }
}
