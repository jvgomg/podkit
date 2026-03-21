---
id: doc-009
title: Podkit Website Branding
type: other
created_date: '2026-03-21 21:47'
---
# Podkit Website Branding

## Design Direction

The podkit website should evoke iPod nostalgia while remaining modern and readable. The typography strategy pairs a pixel-style display font (for headings, hero text, and decorative elements) with a clean humanist sans-serif (for body text and UI).

---

## Typography

### Display Font: Chicago-style pixel font

The original iPod (1st/2nd gen) used Apple's **Chicago** bitmap font, which is iconic to the early iPod era. Since Chicago itself isn't freely licensed, we'll use one of these open recreations:

**Primary candidates:**

- **Chicago FLF** — A faithful recreation of the Chicago bitmap font. Available on dafont.com. Free for personal use (check license for commercial/web use).
- **ChiKareGo** — Another Chicago recreation with good coverage. Pixel-perfect at intended sizes.

**Usage:** Headings, hero text, navigation labels, and decorative elements where we want to evoke the iPod click-wheel interface aesthetic.

**Notes:**
- Pixel fonts look best at their native size or exact multiples — avoid fractional scaling
- Consider providing a fallback sans-serif for accessibility/readability at small sizes
- These fonts are most effective for short text (headings, labels) rather than paragraphs

### Body Font: Source Sans 3

**Source Sans 3** (formerly Source Sans Pro) is the closest open-source alternative to **Myriad Pro** — the font Apple used in iPod-era marketing materials and iTunes.

- Designed by Paul D. Hunt at Adobe
- Adobe's first open-source typeface, with direct design kinship to Myriad Pro
- Available on Google Fonts as a variable font (weights 200–900)
- License: SIL Open Font License (free for all uses including web/commercial)
- 88% similarity rating to Myriad Pro on FontAlternatives

**Usage:** Body text, UI elements, documentation, anywhere readability is the priority.

**Why Source Sans 3 over other alternatives:**

| Font | Similarity to Myriad | Notes |
|------|----------------------|-------|
| **Source Sans 3** | Highest (88%) | Adobe lineage, same humanist philosophy, generous x-height |
| PT Sans | High | Slightly warmer, strong Cyrillic support |
| Fira Sans | Moderate | Wider, more geometric, designed for Mozilla |
| Open Sans | Moderate | More neutral/geometric, less calligraphic |

### Font Pairing Summary

| Role | Font | Source |
|------|------|--------|
| Display/headings | Chicago FLF or ChiKareGo | dafont.com (self-hosted) |
| Body/UI text | Source Sans 3 | Google Fonts |

---

## Other iPod Font History (Reference)

For context on what fonts Apple actually used across iPod generations:

- **Chicago** — Bitmap font on 1st/2nd gen iPods. Classic Mac OS heritage.
- **Podium Sans** — Proportional font on later click-wheel iPods. Custom Apple font, not publicly available.
- **Myriad Pro** — Used in iPod marketing, packaging, and iTunes UI. Commercial font (Adobe).
- **San Francisco** — Apple's current system font (post-2015). Not relevant to iPod era.

---

## Open Questions

- [ ] Verify Chicago FLF license permits web/commercial use — may need to contact the author
- [ ] Decide between Chicago FLF and ChiKareGo (or use both for different contexts)
- [ ] Color palette — should we reference iPod product colors (white, black, Product RED, iPod nano rainbow)?
- [ ] Logo treatment — pixel-style logotype using Chicago font, or something different?
- [ ] Dark mode — iPod UI was light-on-dark on the device but marketing was often white backgrounds
