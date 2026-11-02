//! Runs the external CLIs (claude, npx, git, gh) without a shell and without
//! flashing console windows on Windows.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use tokio::io::{AsyncBufRead, AsyncBufReadExt, BufReader};
use tokio::process::Command;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

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
    cmd.creation_flags(CREATE_NO_WINDOW);
    // Its own group, so `kill_tree` reaches everything it starts.
    #[cfg(unix)]
    cmd.process_group(0);
    Ok(cmd)
}

/// Kills the child and everything it started when dropped (stopped, timed out), unless disarmed
/// after a normal exit. `kill_on_drop` alone misses grandchildren: on Windows `npx`/`npm` are
/// `.cmd` shims run by cmd.exe, and on Unix npx starts the CLI as its own child. The kill is
/// waited for, so a lock the caller holds (`action_lock`) is released only once the tree is gone.
struct KillTree(Option<u32>);

impl Drop for KillTree {
    fn drop(&mut self) {
        if let Some(pid) = self.0 {
            kill_tree(pid);
        }
    }
}

// shortcut: taskkill walks the tree from a live root, so it misses grandchildren once the root has
// exited; use a Job Object if that shows up.
#[cfg(windows)]
fn kill_tree(pid: u32) {
    use std::os::windows::process::CommandExt;
    let _ = std::process::Command::new("taskkill")
        .args(["/T", "/F", "/PID", &pid.to_string()])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .status();
}

#[cfg(unix)]
fn kill_tree(pid: u32) {
    let _ = std::process::Command::new("kill")
        .args(["-KILL", "--", &format!("-{pid}")])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

/// Reads one line, decoded lossily so a stray non-UTF-8 byte doesn't end the stream. `None` at
/// EOF. Safe in `select!`: a partly read line stays in `buf` for the next call.
async fn read_line<R: AsyncBufRead + Unpin>(r: &mut R, buf: &mut Vec<u8>) -> Option<String> {
    r.read_until(b'\n', buf).await.ok()?;
    if buf.is_empty() {
        return None;
    }
    let line = String::from_utf8_lossy(buf).trim_end_matches(['\n', '\r']).to_string();
    buf.clear();
    Some(line)
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
    // Declared after `child` so it drops first, while the tree's root is still alive.
    let mut tree = KillTree(child.id());

    let mut out = BufReader::new(child.stdout.take().expect("piped stdout"));
    let mut err = BufReader::new(child.stderr.take().expect("piped stderr"));
    let (mut out_buf, mut err_buf) = (Vec::new(), Vec::new());
    let mut stdout = String::new();
    let mut stderr = String::new();

    let work = async {
        let (mut out_done, mut err_done) = (false, false);
        while !(out_done && err_done) {
            tokio::select! {
                line = read_line(&mut out, &mut out_buf), if !out_done => match line {
                    Some(l) => { let l = strip_ansi(&l); on_line(&l); stdout.push_str(&l); stdout.push('\n'); }
                    None => out_done = true,
                },
                line = read_line(&mut err, &mut err_buf), if !err_done => match line {
                    Some(l) => { let l = strip_ansi(&l); on_line(&l); stderr.push_str(&l); stderr.push('\n'); }
                    None => err_done = true,
                },
            }
        }
        child.wait().await
    };

    match tokio::time::timeout(timeout, work).await {
        Ok(Ok(status)) => {
            // It exited and was reaped: from here on its pid may belong to someone else.
            tree.0 = None;
            Ok(Output {
                code: status.code(),
                stdout,
                stderr,
            })
        }
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
    use tokio::io::AsyncReadExt;

    #[test]
    fn strips_color_codes() {
        assert_eq!(strip_ansi("\u{1b}[1mUsage:\u{1b}[0m skills"), "Usage: skills");
        assert_eq!(strip_ansi("\u{1b}[38;5;102m$\u{1b}[0m x\r"), "$ x");
    }

    #[tokio::test]
    async fn keeps_reading_past_a_line_that_is_not_utf8() {
        let mut r: &[u8] = b"caf\xe9\r\nnext\nlast";
        let mut buf = Vec::new();
        assert_eq!(read_line(&mut r, &mut buf).await.as_deref(), Some("caf\u{fffd}"));
        assert_eq!(read_line(&mut r, &mut buf).await.as_deref(), Some("next"));
        assert_eq!(read_line(&mut r, &mut buf).await.as_deref(), Some("last"));
        assert_eq!(read_line(&mut r, &mut buf).await, None);
    }

    #[tokio::test]
    async fn stopping_kills_the_whole_tree() {
        // The grandchild inherits stdout, so the pipe only closes once the whole tree is gone.
        #[cfg(windows)]
        let args = to_owned(&["/c", "ping", "-n", "30", "127.0.0.1"]);
        #[cfg(unix)]
        let args = to_owned(&["-c", "sleep 30 & echo up; wait"]);
        let program = if cfg!(windows) { "cmd" } else { "sh" };
        let mut child = command(program, &args, None).unwrap().spawn().unwrap();
        let mut out = BufReader::new(child.stdout.take().unwrap());
        let mut buf = Vec::new();
        assert!(read_line(&mut out, &mut buf).await.is_some(), "the grandchild started");
        drop(KillTree(child.id()));
        let closed = tokio::time::timeout(Duration::from_secs(10), out.read_to_end(&mut buf)).await;
        assert!(closed.is_ok(), "a grandchild still holds the pipe");
    }
}
