# Canvas Design Aesthetics

Detailed guidance for each visual direction when creating art/posters/infographics.

## Brutalist

**Philosophy:** Raw, unpolished, confrontational. Strip away decoration until only structure remains.

**Color:** Monochrome base (black/white) + one accent (red, yellow, or electric blue). No gradients.

**Typography:** Heavy weight, uppercase, tight tracking. Use condensed or industrial typefaces.

**Composition:**
- Visible grid structure -- don't hide the skeleton
- Oversized type as the primary visual element
- High contrast, hard edges
- No rounded corners, no soft shadows

**reportlab example:**
```python
c.setFillColor(HexColor("#000000"))
c.rect(0, 0, width, height, fill=1)
c.setFillColor(HexColor("#ff0000"))
c.rect(0, height * 0.4, width * 0.6, height * 0.2, fill=1)
c.setFillColor(HexColor("#ffffff"))
c.setFont("Helvetica-Bold", 120)
c.drawString(40, height * 0.55, "BRUTAL")
```

## Chromatic

**Philosophy:** Color IS the content. Saturated, overlapping, vibrant.

**Color:** 3-5 high-saturation colors with transparency and blend modes.

**Typography:** Minimal -- let color do the talking. One clean sans-serif if text is needed.

**Composition:**
- Overlapping shapes with varying opacity
- Color field gradients and transitions
- No outlines or borders -- shapes defined by color alone
- Layered depth through transparency

**Pillow example:**
```python
from PIL import Image, ImageDraw

img = Image.new("RGBA", (1920, 1080), (0, 0, 0, 255))
overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
draw = ImageDraw.Draw(overlay)

draw.ellipse([100, 100, 900, 900], fill=(255, 0, 110, 150))
draw.ellipse([500, 200, 1300, 1000], fill=(58, 134, 255, 120))
draw.ellipse([300, 400, 1100, 1200], fill=(6, 214, 160, 100))

img = Image.alpha_composite(img, overlay)
```

## Organic

**Philosophy:** Nature-inspired forms, flowing curves, living systems.

**Color:** Earth tones -- terracotta, sage, ochre, cream, deep brown. Warm undertones.

**Typography:** Rounded or hand-drawn style. Organic letter spacing.

**Composition:**
- Curved shapes, no straight lines
- Asymmetric, flowing layout
- Layered textures suggesting depth
- Irregular edges and boundaries

## Geometric

**Philosophy:** Mathematical precision, pattern, repetition, order.

**Color:** Flat fills, limited palette (3-4 colors). Strong contrast between shapes.

**Typography:** Geometric sans-serif (Futura, Century Gothic, Avant Garde).

**Composition:**
- Grid-based with intentional violations
- Repeating patterns with variation
- Tessellation and tiling
- Sharp edges, precise alignment

**reportlab example:**
```python
import math

colors = ["#264653", "#2a9d8f", "#e9c46a", "#f4a261", "#e76f51"]
for i in range(20):
    for j in range(15):
        c.setFillColor(HexColor(colors[(i + j) % len(colors)]))
        x = i * 50
        y = j * 50
        if (i + j) % 3 == 0:
            c.rect(x, y, 45, 45, fill=1)
        elif (i + j) % 3 == 1:
            c.circle(x + 22, y + 22, 20, fill=1)
        else:
            c.wedge(x, y, x + 45, y + 45, 0, 270, fill=1)
```

## Minimal

**Philosophy:** Maximum impact with minimum elements. Every mark must earn its place.

**Color:** Near-monochrome. 2 colors maximum. Vast negative space.

**Typography:** Precise placement. One typeface. Large size with generous breathing room.

**Composition:**
- One or two focal elements only
- 70%+ of the canvas is empty space
- Perfect alignment and balance
- Restraint IS the design

## Data-Driven / Infographic

**Philosophy:** Make data beautiful and comprehensible at a glance.

**Color:** Categorical palette with clear distinctions between data series.

**Typography:** Clean sans-serif. Large numbers for key metrics. Small labels.

**Composition:**
- Clear visual hierarchy: headline stat > supporting data > labels
- Chart/graph as the centerpiece
- Annotations and callouts for context
- Consistent spacing and alignment

**Key chart types to implement:**
- Bar charts (horizontal preferred for labels)
- Donut charts (not pie -- donut is more readable)
- Sparklines for trends
- Stat callouts (large number + small label)
- Icon arrays for proportions

## Typography Tips for All Directions

- **reportlab built-in fonts:** Helvetica, Helvetica-Bold, Courier, Times-Roman
- **Custom fonts:** Use `pdfmetrics.registerFont()` with TTF files
- **Pillow fonts:** Use `ImageFont.truetype()` with TTF files
- **Fallback:** Always catch font loading errors and fall back to defaults
- **Size hierarchy:** Title 60-120pt, subtitle 24-36pt, body 12-18pt, caption 8-10pt
