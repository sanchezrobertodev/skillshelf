fn main() {
    let git = |args: &[&str]| {
        std::process::Command::new("git")
            .args(args)
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
    };
    // The commit this binary is built from. A copy running from its clone compares origin with it,
    // so an update whose build failed after `git pull` is still offered.
    if let Some(sha) = git(&["rev-parse", "HEAD"]) {
        println!("cargo:rustc-env=SKILLSHELF_COMMIT={sha}");
    }
    // HEAD's reflog changes on every commit, pull and checkout.
    if let Some(log) = git(&["rev-parse", "--git-path", "logs/HEAD"]) {
        println!("cargo:rerun-if-changed={log}");
    }
    tauri_build::build()
}
