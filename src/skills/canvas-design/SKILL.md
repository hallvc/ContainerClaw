---
name: canvas-design
description: "Create visual art, posters, infographics, and designed documents as PDF or PNG files using Python graphics libraries. Use when the user wants visual creative output -- posters, art pieces, data visualizations, styled certificates, event flyers, or any primarily visual (not text) document."
---

# Canvas Design

Create visual art and designed documents using Python. Output is 90% visual, 10% text -- these are art objects, not documents with decoration.

## Two-Phase Workflow

### Phase 1: Design Philosophy

Before touching code, write a short design manifesto (3-5 sentences) capturing:
- The visual concept and mood
- Color strategy
- Typography approach
- Compositional intent

Save as a markdown file alongside the output:
```
docs/designs/YYYY-MM-DD-<name>-philosophy.md
```

### Phase 2: Visual Execution

Translate the philosophy into code. The manifesto guides every decision.

## Tools

### reportlab (PDF output)

```python
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import inch, mm
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor

c = canvas.Canvas("output.pdf", pagesize=landscape(A4))
width, height = landscape(A4)

# Background
c.setFillColor(HexColor("#0f172a"))
c.rect(0, 0, width, height, fill=1)

# Large typography
c.setFillColor(HexColor("#f1f5f9"))
c.setFont("Helvetica-Bold", 72)
c.drawString(1 * inch, height - 3 * inch, "TITLE")

# Geometric shapes
c.setFillColor(HexColor("#3b82f6"))
c.circle(width / 2, height / 2, 2 * inch, fill=1)

# Lines and rules
c.setStrokeColor(HexColor("#f59e0b"))
c.setLineWidth(3)
c.line(1 * inch, 2 * inch, width - 1 * inch, 2 * inch)

c.save()
```

### PIL/Pillow (PNG output)

```python
from PIL import Image, ImageDraw, ImageFont

img = Image.new("RGB", (1920, 1080), color="#0f172a")
draw = ImageDraw.Draw(img)

# Shapes
draw.rectangle([100, 100, 500, 500], fill="#3b82f6")
draw.ellipse([600, 200, 900, 500], fill="#f59e0b")

# Text (use a font file for quality)
try:
    font = ImageFont.truetype("assets/fonts/WorkSans-Bold.ttf", 80)
except:
    font = ImageFont.load_default()
draw.text((100, 600), "HELLO", fill="#f1f5f9", font=font)

# Gradient effect (vertical)
for y in range(1080):
    alpha = y / 1080
    r = int(15 + alpha * 40)
    g = int(23 + alpha * 50)
    b = int(42 + alpha * 80)
    draw.line([(0, y), (1920, y)], fill=(r, g, b))

img.save("output.png", quality=95)
```

## Aesthetic Directions

See [references/aesthetics.md](references/aesthetics.md) for detailed examples of each direction.

### Brutalist
- Stark contrast, raw typography, visible grid structure
- Monochrome + one accent color
- Heavy weight fonts, all caps
- No rounded corners, no gradients

### Chromatic
- Vivid, saturated color fields
- Overlapping transparent shapes
- Color as the primary expressive element
- Minimal text, maximum visual impact

### Organic
- Flowing curves, natural forms
- Earth tones and warm palettes
- Irregular shapes, hand-drawn quality
- Layered textures

### Geometric
- Precise shapes, mathematical compositions
- Grid-based layouts with intentional breaking
- Flat color fills, sharp edges
- Pattern and repetition

### Minimal
- Maximum whitespace
- One or two elements per composition
- Precise typography placement
- Restraint as the design statement

## Composition Principles

- **Rule of thirds** -- place focal elements at intersection points
- **Scale contrast** -- pair very large with very small elements
- **Negative space** -- empty space is an active design element
- **Visual weight balance** -- dark/dense areas balanced by light/open areas
- **Hierarchy** -- one element dominates, others support

## Canvas Sizes

| Use | Dimensions | DPI |
|-----|-----------|-----|
| Poster (A3) | 3508 x 4961 px | 300 |
| Poster (A4) | 2480 x 3508 px | 300 |
| Social media | 1080 x 1080 px | 72 |
| Presentation | 1920 x 1080 px | 72 |
| Desktop wallpaper | 2560 x 1440 px | 72 |

## Dependencies

- `reportlab` -- PDF generation (`pip install reportlab`)
- `Pillow` -- PNG/image generation (`pip install Pillow`)
