// UI text. Each language is one flat JSON file of `"area.key": "text"`. `{name}` placeholders are
// filled from params; keys with plural forms end in `_one` / `_other` (any CLDR form works) and are
// picked by the `count` param. Missing text falls back to English, then to the key itself.

import { Fragment, createElement, type ReactNode } from "react";
import { create } from "zustand";
import en from "./en.json";
import es from "./es.json";
import de from "./de.json";
import fr from "./fr.json";
import pt from "./pt.json";
import ja from "./ja.json";

const base = en;
type Key = keyof typeof base;
/** A key as callers write it: plural keys without their `_one` / `_other` ending. */
export type TKey = Key extends infer K ? (K extends `${infer B}_${"one" | "other"}` ? B : K) : never;
type Params = Record<string, string | number>;

/** Shipped languages, by their own name. Add a JSON file and a line here to add one. */
export const languages = {
  en: "English",
  es: "Español",
  de: "Deutsch",
  fr: "Français",
  pt: "Português (Brasil)",
  ja: "日本語",
} as const;
export type Language = keyof typeof languages;
export type LanguagePref = Language | "system";

// `satisfies` makes the typecheck fail when a shipped language misses a key.
const dicts: Record<Language, Record<string, string>> = {
  en: base,
  es: es satisfies Record<Key, string>,
  de: de satisfies Record<Key, string>,
  fr: fr satisfies Record<Key, string>,
  pt: pt satisfies Record<Key, string>,
  ja: ja satisfies Record<Key, string>,
};

export function resolveLanguage(pref: LanguagePref): Language {
  if (pref !== "system") return pref;
  const wanted = typeof navigator === "undefined" ? [] : navigator.languages;
  for (const tag of wanted) {
    const l = tag.toLowerCase().split("-")[0];
    if (l in languages) return l as Language;
  }
  return "en";
}

/** The language on screen; components re-render through `useT` when it changes. */
const useLang = create<{ lang: Language }>(() => ({ lang: "en" }));
let rules = new Intl.PluralRules("en");
let numbers = new Intl.NumberFormat("en");

export function applyLanguage(pref: LanguagePref) {
  const lang = resolveLanguage(pref);
  rules = new Intl.PluralRules(lang);
  numbers = new Intl.NumberFormat(lang);
  document.documentElement.lang = lang;
  useLang.setState({ lang });
}

/** BCP 47 tag for `toLocaleString` and `Intl`. */
export const locale = () => useLang.getState().lang;

function lookup(key: string, params?: Params): string {
  const d = dicts[locale()];
  const count = params?.count;
  if (typeof count === "number" && `${key}_other` in base) {
    const form = `${key}_${rules.select(count)}`;
    return d[form] ?? d[`${key}_other`] ?? base[form as Key] ?? base[`${key}_other` as Key];
  }
  return d[key] ?? base[key as Key] ?? key;
}

const fmt = (v: string | number) => (typeof v === "number" ? numbers.format(v) : v);

export function t(key: TKey, params?: Params): string {
  const s = lookup(key, params);
  return params ? s.replace(/\{(\w+)\}/g, (m, p: string) => (p in params ? fmt(params[p]) : m)) : s;
}

/** Like `t`, for text with elements inside: `tx("a.b", { link: <a>…</a> })` for `"See {link}."`. */
export function tx(key: TKey, params: Record<string, ReactNode>): ReactNode {
  const parts = lookup(key, typeof params.count === "number" ? { count: params.count } : undefined).split(/\{(\w+)\}/);
  return createElement(
    Fragment,
    null,
    ...parts.map((p, i) => {
      const v = i % 2 ? (p in params ? params[p] : `{${p}}`) : p;
      return createElement(Fragment, { key: i }, typeof v === "number" ? fmt(v) : v);
    }),
  );
}

/** `t` for components: subscribing re-renders them when the language changes. */
export function useT() {
  useLang((s) => s.lang);
  return t;
}

/** Every key in a group (`tray.`), in the current language, for text built on the Rust side. */
export function group(prefix: string): Record<string, string> {
  const d = dicts[locale()];
  return Object.fromEntries(Object.keys(base).filter((k) => k.startsWith(prefix)).map((k) => [k, d[k] ?? base[k as Key]]));
}
