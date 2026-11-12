# Meridian Brand System

Source of truth: meridianstudios.org — _"Boutique web experiences crafted for brands that value
precision, aesthetics, and performance."_ The CRM must feel native to that sentence.

## Principles

1. **Precision** — alignment and spacing are exact. Numbers are tabular. No floating chrome.
2. **Aesthetics** — dark ink canvas, hairline borders, one gradient accent. Everything else earns its place.
3. **Performance** — optimistic UI, skeleton-first loading, no spinner walls, no layout shift.

## Tokens

| Token         | Value                   | Use                          |
| ------------- | ----------------------- | ---------------------------- |
| `--bg`        | `#0a0a0a`               | app canvas                   |
| `--surface`   | `#111111`               | cards, panels                |
| `--surface-2` | `#161616`               | inputs, raised rows          |
| `--border`    | `rgba(255,255,255,.08)` | hairlines                    |
| `--fg`        | `#f5f5f4`               | primary text (stone-100)     |
| `--muted`     | `#a8a29e`               | secondary text (stone-400)   |
| `--accent`    | `#22d3ee`               | cyan; primary actions, focus |
| `--accent-2`  | `#8b5cf6`               | violet; gradient partner     |
| `--success`   | `#34d399`               | won, healthy                 |
| `--warning`   | `#fbbf24`               | at risk                      |
| `--danger`    | `#fb7185`               | lost, destructive            |

Type: **Inter** (400/500/700/900). Display headings: light, wide tracking, occasionally uppercase.
Micro-labels: 10–11px, 900 weight, uppercase, `0.18em` tracking, stone-500. Numbers: `tabular-nums`.

Shape: 14–22px radii on cards (large radius 28px for hero panels), 10px inputs, full-round pills for
status. Borders over shadows; one soft glow only on the accent CTA.

Motion: 120–200ms ease-out. Page sections stagger 30ms. Respect `prefers-reduced-motion`.

## Voice

Terse, confident, studio-grade. "Pipeline" not "sales funnel". No exclamation marks. Empty states
offer the next action. Error copy states what happened and what to do.

## The signature interaction

**Signal** — a ⌘K palette that searches contacts, companies, deals and actions in one list, plus the
**momentum** bar on every deal card: a 3-segment signal that answers "is this deal moving?" at a glance.
These two are the product's novel identity; everything else is execution.
