# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/skillshelf/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file. If not, follow the rules below.

---

**Project:** Skillshelf
**Direction:** Workbench (chosen 2026-10-31, replaces the v0.1 "code dark + run green" dashboard)
**Source:** ui-ux-pro-max: *Productivity Tool* palette (teal focus + action orange), *Minimalism & Swiss Style* structure, IBM Plex type. Colours adjusted so every text pair passes WCAG AA.
**Dials:** Variance 3 (calm, balanced) · Motion 2 (subtle) · Density 7 (dense list, roomy chrome)

---

## Principles

- **A tinted canvas with floating white cards.** The window background is a soft teal-grey. Content (the list, details, overview tiles, the queue) sits on white cards with a soft shadow. In dark mode, cards get a hairline border instead, because shadows don't read on dark.
- **Teal is for action and place.** It marks primary buttons, the active rail item, links and focus.
- **Orange means "update".** Use it only for update status, update buttons and update risk flags, so a pending update is the one warm thing on screen.
- **Status is never colour alone.** Every chip has an icon and text. Every chart has a text alternative (`role="img"` plus `aria-label`).
- **Components use semantic tokens only** (`bg-surface`, `text-muted`, `bg-warn`…), never raw hex.

## Themes

Five palettes, each with a light and a dark block in `src/index.css` that defines every token below. The table shows Workbench, the default.

| Palette | Accent | Notes |
|---|---|---|
| Workbench | teal | Default |
| Graphite | near-black / near-white | Monochrome, so orange updates are the only colour |
| Indigo | indigo | Cool slate surfaces |
| Rose | rose | Updates use amber so they stay distinct from the accent |
| High contrast | dark blue / sky | 7:1 text, hard borders instead of shadows, inverted active rail item |

`node scripts/contrast.mjs` (part of `make check` and CI) checks every text pair of every theme, including chips on their own 12% tints.

## Tokens (`src/index.css`)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#F2F7F7` | `#0A1413` | Window canvas |
| `--surface` | `#FFFFFF` | `#0F1D1C` | Cards, rail, dialogs |
| `--surface-2` | `#E8F1F1` | `#152625` | Wells, code, skeletons |
| `--surface-hover` | `#E0ECEB` | `#1A2E2C` | Hover fill |
| `--border` / `--border-strong` | `#D3E3E2` / `#B9D0CE` | `#1F3533` / `#2C4744` | Dividers / control outlines |
| `--card-border` | transparent | `#1F3533` | Card edge |
| `--fg` | `#10302D` | `#E6F2F1` | Text |
| `--muted` | `#4B5F5D` | `#93AFAC` | Secondary text (≥5.9:1 on every surface) |
| `--accent` (+`-hover`, `-fg`) | `#0F766E` / `#FFFFFF` | `#2DD4BF` / `#04211E` | Primary action, active, links, focus |
| `--warn` (+`-hover`, `-fg`) | `#B43C0A` / `#FFFFFF` | `#FB923C` / `#1C0A02` | Updates only |
| `--danger` | `#B91C1C` | `#F87171` | Destructive, failures |
| `--info` | `#3B5B7A` | `#93B4D4` | Managed, neutral info |
| `--nav-active` / `-fg` | `#D5ECE9` / `#0B5A54` | `#163733` / `#5EEAD4` | Active rail item |
| `--card-shadow` | soft teal-tinted | deep black | Cards |

Contrast was checked with a script: text on surfaces is 5.9–16:1, button text 5.2–9.1:1, and chip text on its own 10–12% tint is 4.8–7.7:1.

## Type

- **UI:** IBM Plex Sans, 14px base, 13px in dense rows, 11px uppercase for section labels (tracking 0.06em).
- **Code, versions, ids, paths, token counts:** JetBrains Mono, 11–12px. JetBrains Mono was already bundled, so it stays instead of Plex Mono.
- Headings are semibold with slight negative tracking. Page title 18px.

## Shape and spacing

- Radius: cards 12px (`rounded-xl`), controls 8px (`rounded-lg`), chips fully rounded.
- Page gutter 20px. Gaps between cards 12px. Card padding 16px (lists use 16px side padding per row).
- Rail 80px: icon (20px) above an 11px label. The active item uses the nav-active fill.

## Layout

```
┌────┬──────────────────────────────────────────────────────────────┐
│Rail│ Page title · status            [search]  [Check now] [Review]│
│    │ (banners: rounded strips, 20px gutter)                       │
│ OV │ ┌filters┐ ┌──────── list card ───────┐ ┌── details card ──┐ │
│ LIB│ │ on bg │ │ header row               │ │                  │ │
│ CU │ │       │ │ rows…                    │ │                  │ │
│ MCP│ └───────┘ └──────────────────────────┘ └──────────────────┘ │
│ ☾ ⚙│ ┌──────────────── queue card (when jobs exist) ───────────┐ │
└────┴──────────────────────────────────────────────────────────────┘
```

- Below 1240px wide, the details card overlays the list instead of sitting beside it.
- Minimum window 960×600.

## Components

- **Buttons:** `primary` (teal), `update` (orange, for update actions only), `secondary` (white with an outline), `ghost`, `danger` (outline). Heights 36 and 32.
- **Status chip:** icon + label, tinted background, 1px tinted border.
- **Charts:** inline SVG sparklines and bars in `--accent`. Each has a text alternative such as "41 uses in the last 30 days".
- **Dialogs:** a card on a teal-tinted scrim. Focus is trapped and returns to where it was. Escape closes.

## Motion

150–200ms colour and opacity transitions only. Nothing moves on hover. `prefers-reduced-motion` turns transitions off.

## Anti-patterns

- Orange anywhere that isn't about an update.
- Colour-only status, or icon-only buttons without `aria-label`.
- Raw hex in components.
- Shadows in dark mode instead of borders.
