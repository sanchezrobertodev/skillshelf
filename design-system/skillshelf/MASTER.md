# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/skillshelf/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file. If not, follow the rules below.

---

**Project:** Skillshelf
**Direction:** Workbench "Aurora" (chosen 2026-11-01, restyles the 2026-10-31 teal Workbench, which replaced the v0.1 "code dark + run green" dashboard)
**Source:** ui-ux-pro-max: *Aurora UI* glow and gradient, a light *Glassmorphism* card, *Minimalism & Swiss Style* structure, Geist type. Colours adjusted so every text pair passes WCAG AA.
**Dials:** Variance 4 (calm, a little expressive) · Motion 2 (subtle) · Density 7 (dense list, roomy chrome)

---

## Principles

- **A glowing canvas with frosted cards.** The window background has three faint glows (teal top-left, violet top-right, pink bottom-right). Content (the list, details, overview tiles, the queue) sits on frosted cards: the surface colour at 78% (72% in dark) with a 20px backdrop blur, a soft shadow and a hairline edge. The glow, the gradient and the glass belong to Workbench only; the other palettes stay flat and opaque.
- **Violet is for action and place.** It marks the active rail item, links, switches and focus. Primary buttons use the violet-to-teal gradient with a soft violet glow.
- **Orange means "update".** Use it only for update status, update buttons and update risk flags, so a pending update is the one warm thing on screen.
- **Status is never colour alone.** Every chip has an icon and text. Every chart has a text alternative (`role="img"` plus `aria-label`).
- **Components use semantic tokens only** (`bg-surface`, `text-muted`, `bg-warn`…), never raw hex.

## Themes

Five palettes, each with a light and a dark block in `src/index.css` that defines every token below. The table shows Workbench, the default.

| Palette | Accent | Notes |
|---|---|---|
| Workbench | violet, violet-to-teal gradient | Default. Glow, gradient primary buttons and frosted cards |
| Graphite | near-black / near-white | Monochrome, so orange updates are the only colour |
| Indigo | blue indigo (`#3B5BDB` / `#91A7FF`) | Cool slate surfaces, flat. Bluer than Workbench's violet so the two stay apart |
| Rose | rose | Updates use amber so they stay distinct from the accent |
| High contrast | dark blue / sky | 7:1 text, hard borders instead of shadows, inverted active rail item |

`node scripts/contrast.mjs` (part of `make check` and CI) checks every text pair of every theme, including chips on their own 12% tints, and `--accent-fg` on every `--accent-grad` stop and halfway between stops.

## Tokens (`src/index.css`)

Workbench values:

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#F5F6FB` | `#07081A` | Window canvas |
| `--surface` | `#FFFFFF` | `#11132B` | Cards, rail, dialogs |
| `--surface-2` | `#EFF0F8` | `#171A37` | Wells, code, skeletons |
| `--surface-hover` | `#E9EBF7` | `#1E2244` | Hover fill |
| `--border` / `--border-strong` | `#E2E4F0` / `#C9CDE2` | `#242850` / `#363C6C` | Dividers / control outlines |
| `--card-border` | white 70% | white 7% | Card edge |
| `--fg` | `#13142E` | `#ECEEFE` | Text |
| `--muted` | `#545A78` | `#A4A9D0` | Secondary text |
| `--accent` (+`-hover`, `-fg`) | `#6D28D9` / `#FFFFFF` | `#A78BFA` / `#140A32` | Active, links, focus, solid primary |
| `--warn` (+`-hover`, `-fg`) | `#B43C0A` / `#FFFFFF` | `#FB923C` / `#1C0A02` | Updates only |
| `--danger` | `#B91C1C` | `#F87171` | Destructive, failures |
| `--info` | `#3B5B7A` | `#93B4D4` | Managed, neutral info |
| `--nav-active` / `-fg` | `#EDE7FD` / `#5B21B6` | `#241D4F` / `#C4B5FD` | Active rail item |
| `--card-shadow` | soft violet-tinted | deep black | Cards |

Workbench-only style tokens, read by the `[data-palette="workbench"]` rules in `src/index.css`:

| Token | Light | Dark | Use |
|---|---|---|---|
| `--accent-grad` | `#7C3AED` → `#5B4BE0` → `#0F766E` | `#C4B5FD` → `#A78BFA` → `#5EEAD4` | Primary buttons (`.btn-primary`), 135° |
| `--accent-glow` | violet, 45% | lavender, 45% | Primary button shadow |
| `--veil` | black 12% | white 16% | Laid over the gradient on hover; keeps or raises text contrast |
| `--glass` | 78% | 72% | Card opacity (`.card`) |
| `--glow` | teal / violet / pink, 8–18% | teal / violet / pink, 10–26% | Canvas background |

## Type

- **UI:** Geist, 14px base, 13px in dense rows, 11px uppercase for section labels (tracking 0.06em). Applies to every palette.
- **Code, versions, ids, paths, token counts:** JetBrains Mono, 11–12px.
- Headings are semibold with slight negative tracking. Page title 18px.

## Shape and spacing

- Radius: cards 16px (`rounded-2xl`), controls 8px (`rounded-lg`), chips fully rounded.
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

- **Buttons:** `primary` (accent; the violet-to-teal gradient on Workbench), `update` (orange, for update actions only), `secondary` (white with an outline), `ghost`, `danger` (outline). Heights 36 and 32.
- **Status chip:** icon + label, tinted background, 1px tinted border.
- **Charts:** inline SVG sparklines and bars in `--accent`. Each has a text alternative such as "41 uses in the last 30 days".
- **Dialogs:** a card on a tinted scrim. Focus is trapped and returns to where it was. Escape closes.

## Motion

150–200ms colour and opacity transitions only. Nothing moves on hover. `prefers-reduced-motion` turns transitions off.

## Anti-patterns

- Orange anywhere that isn't about an update.
- Colour-only status, or icon-only buttons without `aria-label`.
- Raw hex in components.
- Shadows in dark mode instead of borders.
- Glow, gradients or glass outside Workbench's own rules, or on text.
