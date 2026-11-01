//! Skill problems found offline after a scan: front matter, description, and names that clash.
//! Missing or replaced `skills` CLI links are found by the scanner, which knows the lockfile.

use std::path::Path;

use crate::model::{Issue, Item, Kind};
use crate::scan::front_matter_block;

/// Claude Code's limit for a skill description.
const MAX_DESCRIPTION: usize = 1024;

pub fn issue(code: &str, message: impl Into<String>) -> Issue {
    Issue {
        code: code.into(),
        message: message.into(),
    }
}

pub fn check(items: &mut [Item]) {
    for item in items.iter_mut().filter(|i| i.kind == Kind::Skill) {
        let text = item
            .path
            .as_ref()
            .and_then(|p| std::fs::read_to_string(Path::new(p).join("SKILL.md")).ok());
        let found = skill_issues(text.as_deref(), item.description.as_deref());
        item.issues.extend(found);
    }

    // Two skills with one name in the same session: only one of them is used.
    let skills: Vec<(usize, String, Option<String>, String)> = items
        .iter()
        .enumerate()
        .filter(|(_, i)| i.kind == Kind::Skill)
        .map(|(n, i)| {
            (
                n,
                i.name.clone(),
                i.meta.get("Project").cloned(),
                i.path.clone().unwrap_or_default(),
            )
        })
        .collect();
    for (n, name, project, _) in &skills {
        let clashes: Vec<&str> = skills
            .iter()
            .filter(|(m, other, other_project, _)| {
                m != n && other == name && (project.is_none() || other_project.is_none() || other_project == project)
            })
            .map(|(.., path)| path.as_str())
            .collect();
        if !clashes.is_empty() {
            items[*n].issues.push(issue(
                "duplicate-name",
                format!(
                    "Another skill is also named `{name}` and loads in the same sessions ({}). Only one of them is used.",
                    clashes.join(", ")
                ),
            ));
        }
    }
}

/// `skill_md` is `None` when SKILL.md couldn't be read; its front matter isn't judged then.
fn skill_issues(skill_md: Option<&str>, description: Option<&str>) -> Vec<Issue> {
    let mut out = Vec::new();
    match skill_md.map(front_matter_block) {
        None => {}
        Some(None) => out.push(issue(
            "no-frontmatter",
            "SKILL.md doesn't start with front matter (a --- block with name and description).",
        )),
        Some(Some(block)) if !matches!(serde_yaml::from_str(&block), Ok(serde_yaml::Value::Mapping(_))) => out.push(issue(
            "bad-frontmatter",
            "The front matter isn't valid YAML, so Claude Code may not read the name and description. Quote values that contain \": \".",
        )),
        Some(Some(_)) => {}
    }
    match description.map(|d| d.chars().count()) {
        None => out.push(issue(
            "no-description",
            "No description, so Claude can't tell when to use this skill.",
        )),
        Some(n) if n > MAX_DESCRIPTION => out.push(issue(
            "long-description",
            format!("The description is {n} characters. Claude Code's limit is 1,024, so it may be cut off."),
        )),
        _ => {}
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Source;

    fn codes(v: &[Issue]) -> Vec<&str> {
        v.iter().map(|i| i.code.as_str()).collect()
    }

    #[test]
    fn front_matter_and_description_rules() {
        assert!(skill_issues(Some("---\nname: a\ndescription: b\n---\n"), Some("b")).is_empty());
        assert_eq!(
            codes(&skill_issues(Some("# Title"), None)),
            ["no-frontmatter", "no-description"]
        );
        assert_eq!(
            codes(&skill_issues(
                Some("---\nname: a\ndescription: Use when: x\n---\n"),
                Some("Use when: x")
            )),
            ["bad-frontmatter"]
        );
        let long = "d".repeat(1025);
        assert_eq!(
            codes(&skill_issues(Some("---\nname: a\n---\n"), Some(&long))),
            ["long-description"]
        );
        assert_eq!(
            codes(&skill_issues(None, Some("d"))),
            Vec::<&str>::new(),
            "unreadable SKILL.md isn't judged"
        );
    }

    #[test]
    fn duplicate_names_only_clash_within_a_session() {
        let skill = |id: &str, name: &str, project: Option<&str>| {
            let mut i = Item::new(id.into(), Kind::Skill, Source::Local, name.into());
            i.description = Some("d".into());
            i.path = Some(format!("/skills/{id}"));
            if let Some(p) = project {
                i.meta.insert("Project".into(), p.into());
            }
            i
        };
        let mut items = vec![
            skill("a", "same", None),
            skill("b", "same", Some("/p1")),
            skill("c", "proj", Some("/p1")),
            skill("d", "proj", Some("/p2")),
        ];
        check(&mut items);
        let dup = |i: &Item| i.issues.iter().any(|x| x.code == "duplicate-name");
        assert!(dup(&items[0]) && dup(&items[1]));
        assert!(
            !dup(&items[2]) && !dup(&items[3]),
            "different projects never load together"
        );
        assert!(items[0].issues.iter().any(|x| x.message.contains("/skills/b")));
    }
}
