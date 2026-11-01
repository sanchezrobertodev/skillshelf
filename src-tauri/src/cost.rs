//! Rough tokens an item adds to every session: the skill, command and agent listings Claude Code
//! always sends (name plus description). MCP tool definitions and hook output can't be known
//! without running them, so they aren't counted.

use serde::Serialize;

use crate::model::{Item, Kind};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Cost {
    pub total: u32,
    pub parts: Vec<CostPart>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CostPart {
    /// skill | command | agent
    pub kind: String,
    pub name: String,
    pub tokens: u32,
}

/// shortcut: chars/4 plus a few tokens of list formatting per entry; swap for a real tokenizer if it misleads.
fn tokens(name: &str, description: Option<&str>) -> u32 {
    let chars = name.chars().count() + description.map_or(0, |d| d.chars().count()) + 6;
    chars.div_ceil(4) as u32
}

pub fn estimate(item: &Item) -> Option<Cost> {
    let parts: Vec<CostPart> = match item.kind {
        Kind::Skill => vec![CostPart {
            kind: "skill".into(),
            name: item.name.clone(),
            tokens: tokens(&item.name, item.description.as_deref()),
        }],
        // Plugin entries are listed as `plugin:name`.
        Kind::Plugin => item
            .children
            .iter()
            .filter(|c| matches!(c.kind.as_str(), "skill" | "command" | "agent"))
            .map(|c| {
                let name = format!("{}:{}", item.name, c.name);
                CostPart {
                    kind: c.kind.clone(),
                    tokens: tokens(&name, c.description.as_deref()),
                    name,
                }
            })
            .collect(),
    };
    if parts.is_empty() {
        return None;
    }
    Some(Cost {
        total: parts.iter().map(|p| p.tokens).sum(),
        parts,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Child, Source};

    #[test]
    fn plugin_cost_is_its_listed_entries() {
        let mut p = Item::new("plugin:x@m:user".into(), Kind::Plugin, Source::Marketplace, "x".into());
        let child = |kind: &str, name: &str, d: Option<&str>| Child {
            kind: kind.into(),
            name: name.into(),
            description: d.map(str::to_string),
        };
        p.children = vec![
            child("skill", "alpha", Some("Use when drawing diagrams.")), // 7 + 26 + 6 = 39 chars
            child("agent", "bot", None),                                 // 5 + 6 = 11
            child("mcp", "srv", None),
            child("hook", "SessionStart", None),
        ];
        let c = estimate(&p).unwrap();
        assert_eq!(c.parts.len(), 2);
        assert_eq!(c.parts[0].name, "x:alpha");
        assert_eq!((c.parts[0].tokens, c.parts[1].tokens, c.total), (10, 3, 13));

        p.children.retain(|c| c.kind == "mcp");
        assert_eq!(estimate(&p), None);
    }

    #[test]
    fn skill_cost_counts_name_and_description() {
        let mut s = Item::new("skill:a".into(), Kind::Skill, Source::Local, "abcd".into());
        s.description = Some("x".repeat(90));
        assert_eq!(estimate(&s).unwrap().total, 25);
    }
}
