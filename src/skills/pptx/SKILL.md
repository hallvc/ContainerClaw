---
name: pptx
description: "Create, read, edit, and design PowerPoint presentations (.pptx). Use when the user needs to: create slide decks, edit existing presentations, parse slide content, or generate thumbnails."
---

# PowerPoint Presentations

## Creating Presentations (JavaScript)

Use `pptxgenjs` for creating presentations from scratch. See [references/pptxgenjs.md](references/pptxgenjs.md) for the complete API reference.

### Quick start

```javascript
const PptxGenJS = require("pptxgenjs");
const pptx = new PptxGenJS();

pptx.defineLayout({ name: "WIDE", width: 13.33, height: 7.5 });
pptx.layout = "WIDE";

const slide = pptx.addSlide();
slide.background = { color: "1a1a2e" };

slide.addText("Presentation Title", {
  x: 0.5, y: 1.5, w: "90%", h: 1.5,
  fontSize: 44, fontFace: "Arial",
  color: "ffffff", bold: true
});

slide.addText("Subtitle text here", {
  x: 0.5, y: 3.5, w: "90%",
  fontSize: 20, color: "cccccc"
});

pptx.writeFile({ fileName: "output.pptx" });
```

Install: `npm install pptxgenjs`

## Reading Presentations

### Extract text with markitdown

```bash
markitdown input.pptx > slides.md
```

### Generate thumbnails

```bash
python scripts/thumbnail.py input.pptx --output thumbs/ --size 800x600
```

## Editing Existing Presentations

Presentations are ZIP archives of XML. To edit:

1. **Unpack**: `python scripts/unpack.py input.pptx work_dir/`
2. **Edit slide XML** in `work_dir/ppt/slides/`
3. **Repack**: `cd work_dir && zip -r ../output.pptx . -x ".*"`

See [references/editing.md](references/editing.md) for XML editing patterns.

## Design Guidance

### Color palettes

Choose a cohesive palette. Avoid white backgrounds with black text -- they look generic.

| Name | Background | Primary | Accent 1 | Accent 2 | Text |
|------|-----------|---------|----------|----------|------|
| Midnight Executive | #0d1117 | #1f2937 | #3b82f6 | #60a5fa | #f8fafc |
| Forest & Moss | #1a2e1a | #2d4a2d | #4ade80 | #86efac | #f0fdf4 |
| Coral Energy | #fff5f5 | #fed7d7 | #f56565 | #fc8181 | #1a202c |
| Warm Terracotta | #1c1917 | #44403c | #d97706 | #f59e0b | #fef3c7 |
| Teal Trust | #042f2e | #134e4a | #14b8a6 | #2dd4bf | #f0fdfa |

### Typography

- **Headings**: Bold, 28-44pt. Use distinctive fonts (Poppins, Montserrat, Raleway).
- **Body**: Regular, 16-20pt. Pair with readable fonts (Lora, Source Sans, Open Sans).
- **Data/code**: Monospace, 14-16pt (JetBrains Mono, Fira Code).

### Layout patterns

- **Title slide**: Full-bleed background, centered title, subtle accent line
- **Two-column**: 60/40 or 50/50 split for text + visual
- **Icon + text grid**: 2x2 or 3x2 grid with icon above short text
- **Stat callout**: Large number (60pt+) with context below (16pt)
- **Timeline**: Horizontal flow with nodes and connecting lines
- **Half-bleed image**: Image fills one half, text on the other

### Anti-patterns to avoid

- Plain white backgrounds with bullet points
- Clip art or stock photos
- More than 6 bullet points per slide
- Walls of text -- if it needs a paragraph, it needs a document
- Default PowerPoint templates
