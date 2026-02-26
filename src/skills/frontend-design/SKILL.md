---
name: frontend-design
description: "Create distinctive, production-quality frontend interfaces. Use when building web UIs, dashboards, landing pages, or any HTML/CSS/JS output. Provides design thinking, typography, color, motion, and layout guidance to avoid generic 'AI slop' aesthetics."
---

# Frontend Design

Build interfaces that look intentionally designed, not generated.

## Design Thinking Framework

Before writing code, answer these four questions:

1. **Purpose** -- What is the user trying to accomplish?
2. **Tone** -- What feeling should this evoke? (professional, playful, luxurious, minimal)
3. **Constraints** -- Device targets, accessibility, performance budget?
4. **Differentiation** -- What makes this look distinctive rather than generic?

## Typography

Typography is the strongest design signal. Choose fonts that match the tone.

### Font pairing examples

| Tone | Heading | Body |
|------|---------|------|
| Editorial | Playfair Display | Source Serif Pro |
| Tech/modern | Space Grotesk | DM Sans |
| Luxury | Cormorant Garamond | Lato |
| Playful | Sora | Nunito |
| Brutalist | Oswald | Space Mono |
| Craft/organic | Young Serif | Work Sans |

### Rules

- Never use more than 2-3 font families
- Heading/body should contrast in weight or style (serif + sans-serif)
- Use CSS custom properties for font stacks
- Set a modular type scale (1.25 or 1.333 ratio)

### Avoid these fonts

Inter, Roboto, Arial, Helvetica as primary design fonts -- they signal "default" and make output look generic. They are fine as body fallbacks.

## Color

### Build a palette

1. Pick a dominant color that matches the tone
2. Add 1-2 accents that complement or contrast
3. Define light/dark neutrals for backgrounds and text
4. Use CSS custom properties throughout

```css
:root {
  --color-bg: #0f172a;
  --color-surface: #1e293b;
  --color-primary: #3b82f6;
  --color-accent: #f59e0b;
  --color-text: #f1f5f9;
  --color-muted: #94a3b8;
}
```

### Avoid

- Purple-to-blue gradients on white (the canonical "AI slop" palette)
- Pure black (#000) on pure white (#fff)
- More than 5 colors in a palette
- Using color as the only way to convey information (accessibility)

## Layout & Spatial Composition

### Principles

- **Whitespace is design** -- generous padding > cramped content
- **Asymmetry creates interest** -- break the 50/50 grid occasionally
- **Visual hierarchy** -- one clear focal point per viewport
- **Overlap and layering** -- elements can break grid boundaries

### Layout patterns

- **Bento grid**: Mixed-size cards in a CSS grid with `gap`
- **Split screen**: Hero with 60/40 or 70/30 text/visual split
- **Offset grid**: Alternating left/right alignment for rhythm
- **Full-bleed sections**: Background color/image spans viewport, content constrained
- **Sticky sidebar**: Navigation fixed, content scrolls

### Avoid

- Everything centered in a single column
- Uniform card grids with identical rounded corners
- Symmetrical layouts with no visual tension

## Motion & Animation

### CSS transitions

```css
.card {
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}
.card:hover {
  transform: translateY(-4px);
  box-shadow: 0 12px 24px rgba(0, 0, 0, 0.15);
}
```

### Scroll-triggered animations

```css
@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}

.animate-on-scroll {
  animation: fadeInUp 0.6s ease forwards;
}
```

### Rules

- Animations should be fast (150-300ms) and purposeful
- Use `ease` or `ease-out` for entering, `ease-in` for exiting
- Reduce motion for `prefers-reduced-motion` media query
- Stagger list items with incremental `animation-delay`

## Backgrounds & Textures

- **Gradient meshes**: Overlapping radial gradients with `mix-blend-mode`
- **Noise/grain**: CSS `filter: url(#noise)` or SVG filter for texture
- **Subtle patterns**: Repeating SVG or CSS gradients for depth
- **Glass morphism**: `backdrop-filter: blur(12px)` with semi-transparent background

## Detailed Aesthetic Directions

See [references/aesthetics.md](references/aesthetics.md) for in-depth examples of specific aesthetic directions:
- Brutally minimal
- Maximalist/expressive
- Retro-futuristic
- Soft/pastel
- Industrial
- Art deco
- Editorial

## Implementation

Match code complexity to aesthetic vision:
- **Minimal design** = precision code (exact spacing, careful typography)
- **Maximalist design** = elaborate code (layered backgrounds, animations, effects)
- **Dark themes** = pay extra attention to contrast ratios and text legibility

Always include responsive breakpoints and semantic HTML.
