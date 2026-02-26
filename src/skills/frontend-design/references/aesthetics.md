# Aesthetic Directions

Detailed examples for each design direction.

## Brutally Minimal

- **Colors**: Monochrome (black, white, one gray)
- **Typography**: One font, large sizes, lots of whitespace
- **Layout**: Generous margins, sparse content, intentional emptiness
- **Elements**: Thin rules, no borders, no shadows
- **Interaction**: Subtle state changes only

```css
:root {
  --color-bg: #fafafa;
  --color-text: #111;
  --color-muted: #888;
  --font: "Suisse Intl", "Helvetica Neue", sans-serif;
}
body { font-family: var(--font); max-width: 640px; margin: 8rem auto; }
h1 { font-size: 3rem; font-weight: 300; letter-spacing: -0.02em; }
a { color: var(--color-text); text-decoration-thickness: 1px; }
```

## Maximalist / Expressive

- **Colors**: 4-5 vibrant, high-saturation colors
- **Typography**: Mixed fonts, varied sizes, overlapping text
- **Layout**: Layered elements, broken grids, asymmetry
- **Elements**: Heavy borders, bold shapes, gradients
- **Interaction**: Animated transitions, hover effects, scroll-triggered animations

```css
:root {
  --neon-pink: #ff006e;
  --electric-blue: #3a86ff;
  --acid-green: #06d6a0;
  --hot-orange: #fb5607;
  --deep-purple: #8338ec;
}
.hero { position: relative; overflow: hidden; }
.hero::before {
  content: ""; position: absolute; inset: 0;
  background: conic-gradient(from 45deg, var(--neon-pink), var(--electric-blue), var(--acid-green));
  opacity: 0.3; z-index: -1;
}
```

## Retro-Futuristic

- **Colors**: Dark backgrounds with neon accents (cyan, magenta, amber)
- **Typography**: Monospace or geometric sans-serif
- **Layout**: Grid-based with terminal-like sections
- **Elements**: Glowing borders, scan lines, CRT effects
- **Interaction**: Type-writer text effects, blinking cursors

```css
:root {
  --bg: #0a0a0a;
  --terminal-green: #00ff41;
  --scan-line: rgba(0, 255, 65, 0.05);
}
body { background: var(--bg); color: var(--terminal-green); font-family: "JetBrains Mono", monospace; }
.panel {
  border: 1px solid var(--terminal-green);
  box-shadow: 0 0 10px rgba(0, 255, 65, 0.2), inset 0 0 10px rgba(0, 255, 65, 0.05);
}
```

## Soft / Pastel

- **Colors**: Muted, low-saturation pastels with warm undertones
- **Typography**: Rounded sans-serif, generous line height
- **Layout**: Rounded corners, soft shadows, card-based
- **Elements**: Subtle gradients, no hard edges
- **Interaction**: Gentle scale and opacity transitions

```css
:root {
  --rose: #fecdd3;
  --lavender: #e9d5ff;
  --mint: #bbf7d0;
  --sky: #bae6fd;
  --cream: #fef9ef;
  --text: #44403c;
}
.card {
  background: white; border-radius: 1rem; padding: 2rem;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.04);
}
```

## Industrial

- **Colors**: Concrete gray, rust orange, matte black, raw white
- **Typography**: Condensed, uppercase, heavy weight
- **Layout**: Visible structure (thick borders, grid lines)
- **Elements**: Raw textures, exposed grid, utility aesthetic
- **Interaction**: Sharp, no-nonsense transitions

```css
:root {
  --concrete: #d4d4d8;
  --rust: #c2410c;
  --steel: #27272a;
  --raw: #fafaf9;
}
.container { border: 3px solid var(--steel); }
h1 { font-family: "Oswald", sans-serif; text-transform: uppercase; letter-spacing: 0.1em; }
```

## Art Deco

- **Colors**: Gold, black, cream, deep emerald or navy
- **Typography**: Geometric display fonts, all caps headers
- **Layout**: Symmetrical, chevron patterns, fan shapes
- **Elements**: Gold lines and accents, geometric ornaments
- **Interaction**: Elegant, measured transitions

```css
:root {
  --gold: #d4a574;
  --black: #1a1a1a;
  --cream: #f5f0e8;
  --emerald: #064e3b;
}
.divider {
  height: 2px; background: linear-gradient(90deg, transparent, var(--gold), transparent);
  margin: 3rem 0;
}
h1 { font-family: "Poiret One", sans-serif; letter-spacing: 0.15em; text-transform: uppercase; }
```

## Editorial

- **Colors**: High contrast, limited palette (2-3 colors max)
- **Typography**: Serif headlines + sans-serif body, strong hierarchy
- **Layout**: Column-based, magazine-style, pull quotes
- **Elements**: Drop caps, thin rules, ample margins
- **Interaction**: Smooth scroll, parallax sections

```css
:root {
  --ink: #1c1917;
  --paper: #faf9f5;
  --accent: #dc2626;
}
h1 { font-family: "Playfair Display", serif; font-size: 3.5rem; line-height: 1.1; }
p { font-family: "Source Sans Pro", sans-serif; font-size: 1.125rem; line-height: 1.75; max-width: 65ch; }
.drop-cap::first-letter { font-size: 4em; float: left; line-height: 0.8; margin-right: 0.1em; }
```
