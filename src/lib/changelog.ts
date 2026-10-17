import { useCallback, useEffect, useState } from "react";
import { api, errorText } from "../api";
import type { Changelog, Item } from "../types";

export type ChangelogState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; log: Changelog }
  | { status: "error"; error: string };

// Kept per version pair so reopening an item doesn't ask the backend (or GitHub) again.
const cache = new Map<string, Changelog>();
const pending = new Map<string, Promise<Changelog>>();
const keyOf = (i: Item) => `${i.id}\n${i.version ?? ""}\n${i.latest ?? ""}`;

function fetchChangelog(item: Item): Promise<Changelog> {
  const key = keyOf(item);
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  let p = pending.get(key);
  if (!p) {
    p = api
      .changelog(item.id)
      .then((log) => {
        cache.set(key, log);
        return log;
      })
      .finally(() => pending.delete(key));
    pending.set(key, p);
  }
  return p;
}

/** Items with something to say: an update is waiting, or the source never publishes changes. */
export function showsChangelog(i: Item) {
  return i.status === "updateAvailable" || i.status === "managed" || i.status === "untracked";
}

/** Fetches the item's changelog on demand (only while `enabled`). */
export function useChangelog(item: Item, enabled = true) {
  const key = keyOf(item);
  const [state, setState] = useState<ChangelogState>(() => {
    const hit = cache.get(key);
    return hit ? { status: "ready", log: hit } : { status: "idle" };
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const hit = cache.get(key);
    if (hit) {
      setState({ status: "ready", log: hit });
      return;
    }
    setState({ status: "loading" });
    fetchChangelog(item).then(
      (log) => live && setState({ status: "ready", log }),
      (e) => live && setState({ status: "error", error: errorText(e) }),
    );
    return () => {
      live = false;
    };
    // `item` is covered by `key`, which changes whenever the item's versions do.
  }, [key, enabled, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, retry };
}

export function isEmpty(log: Changelog) {
  return log.entries.length === 0 && log.sections.length === 0;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** One line for the update confirmation, e.g. "2 releases (1.7.4, 1.7.3) · 26 commits". */
export function changelogCounts(log: Changelog): string | null {
  const parts: string[] = [];
  if (log.sections.length) {
    const versions = log.sections.map((s) => s.version).filter(Boolean) as string[];
    const shown = versions.slice(0, 2).join(", ");
    const more = versions.length > 2 ? ` +${versions.length - 2}` : "";
    parts.push(`${plural(log.sections.length, "release")}${shown ? ` (${shown}${more})` : ""}`);
  }
  if (log.total) parts.push(plural(log.total, "commit"));
  return parts.length ? parts.join(" · ") : null;
}

/** The newest change in words: the latest commit's message, else the newest release's first line. */
export function newestChange(log: Changelog): string | null {
  if (log.entries[0]?.message) return log.entries[0].message;
  const body = log.sections[0]?.body ?? "";
  const line = body
    .split("\n")
    .map((l) => l.replace(/^[#>*+\-\s]+/, "").trim())
    .find((l) => l.length > 0);
  return line ?? null;
}
