//! Network/git checks that decide whether each item has an update.

pub mod plugins;
pub mod skills;

use crate::model::{CheckInfo, CheckResult, Item, Source, Status, now_ms};

#[derive(Debug, Clone, PartialEq)]
pub struct Outcome {
    pub status: Status,
    pub latest: Option<String>,
    pub detail: Option<String>,
}

impl Outcome {
    pub fn new(status: Status, latest: Option<String>, detail: Option<String>) -> Self {
        Outcome { status, latest, detail }
    }
    pub fn unknown(detail: impl Into<String>) -> Self {
        Outcome::new(Status::Unknown, None, Some(detail.into()))
    }
    pub fn error(detail: impl Into<String>) -> Self {
        Outcome::new(Status::Error, None, Some(detail.into()))
    }
}

pub async fn check_all(mut items: Vec<Item>) -> CheckResult {
    let mut warnings = Vec::new();

    let has_marketplace = items.iter().any(|i| i.source == Source::Marketplace);
    if has_marketplace && let Err(e) = plugins::refresh_marketplaces().await {
        warnings.push(format!(
            "Could not refresh marketplaces ({e}); using the last downloaded catalogs."
        ));
    }

    let plugin_checks = futures::future::join_all(
        items
            .iter()
            .enumerate()
            .filter(|(_, i)| i.source == Source::Marketplace)
            .map(|(idx, i)| {
                let check = i.check.clone();
                async move { (idx, plugins::check(&check).await) }
            }),
    );
    let skill_checks = skills::check(&items);
    let manifest_checks = futures::future::join_all(items.iter().enumerate().filter_map(|(idx, i)| match &i.check {
        CheckInfo::ReleaseManifest { url, version } if i.source != Source::SkillsCli => {
            let (url, version) = (url.clone(), version.clone());
            Some(async move { (idx, skills::check_manifest(&url, version.as_deref()).await) })
        }
        _ => None,
    }));

    let (plugin_results, (skill_results, skill_warnings), manifest_results) =
        tokio::join!(plugin_checks, skill_checks, manifest_checks);
    warnings.extend(skill_warnings);

    let mut outcomes: Vec<Option<Outcome>> = vec![None; items.len()];
    for (idx, o) in plugin_results.into_iter().chain(skill_results).chain(manifest_results) {
        outcomes[idx] = Some(o);
    }

    for (item, outcome) in items.iter_mut().zip(outcomes) {
        let outcome = outcome.unwrap_or_else(|| match item.source {
            Source::Synced => Outcome::new(
                Status::Managed,
                None,
                Some("Updated by your claude.ai organization".into()),
            ),
            Source::Local | Source::Project => Outcome::new(
                Status::Untracked,
                None,
                Some("Not installed by a tool that tracks updates".into()),
            ),
            _ => Outcome::unknown("Nothing to compare against"),
        });
        item.status = outcome.status;
        item.latest = outcome.latest;
        item.status_detail = outcome.detail;
    }

    CheckResult {
        items,
        warnings,
        checked_at: now_ms(),
    }
}

/// Compares two version strings when both are semver (a leading `v` is allowed).
pub fn semver_newer(installed: &str, latest: &str) -> Option<bool> {
    let parse = |s: &str| semver::Version::parse(s.trim().trim_start_matches('v')).ok();
    Some(parse(latest)? > parse(installed)?)
}

pub fn looks_like_sha(s: &str) -> bool {
    (7..=40).contains(&s.len()) && s.chars().all(|c| c.is_ascii_hexdigit())
}

pub fn short(sha: &str) -> String {
    sha.chars().take(12).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn semver_comparison() {
        assert_eq!(semver_newer("2.13.0", "2.14.0"), Some(true));
        assert_eq!(semver_newer("v1.2.0", "1.2.0"), Some(false));
        assert_eq!(semver_newer("ea10b213686c", "1.0.0"), None);
    }

    #[test]
    fn sha_detection() {
        assert!(looks_like_sha("ea10b213686c"));
        assert!(!looks_like_sha("1.2.0"));
    }
}
