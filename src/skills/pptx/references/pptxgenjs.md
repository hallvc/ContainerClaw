# pptxgenjs API Reference

## Setup

```javascript
const PptxGenJS = require("pptxgenjs");
const pptx = new PptxGenJS();

// Widescreen layout (recommended)
pptx.defineLayout({ name: "WIDE", width: 13.33, height: 7.5 });
pptx.layout = "WIDE";

// Metadata
pptx.author = "Author Name";
pptx.title = "Presentation Title";
```

## Slides

```javascript
const slide = pptx.addSlide();

// Background
slide.background = { color: "1a1a2e" };          // solid color
slide.background = { path: "bg.jpg" };            // image
slide.background = { data: "data:image/png;..." }; // base64
```

## Text

```javascript
slide.addText("Simple text", { x: 0.5, y: 0.5, fontSize: 24 });

// Rich text with multiple runs
slide.addText([
  { text: "Bold ", options: { bold: true, fontSize: 20 } },
  { text: "and italic", options: { italic: true, fontSize: 20 } },
], { x: 0.5, y: 1.5, w: 5 });

// Full options
slide.addText("Styled", {
  x: 0.5, y: 2.5, w: "90%", h: 1,
  fontSize: 36,
  fontFace: "Poppins",
  color: "ffffff",
  bold: true,
  italic: false,
  underline: { style: "sng" },
  align: "center",    // left, center, right, justify
  valign: "middle",   // top, middle, bottom
  fill: { color: "3b82f6" },
  shadow: { type: "outer", blur: 3, offset: 2, color: "000000", opacity: 0.4 },
  rotate: 0,
  lineSpacing: 28,
  paraSpaceBefore: 6,
  paraSpaceAfter: 6,
});
```

## Shapes

```javascript
// Rectangle
slide.addShape(pptx.ShapeType.rect, {
  x: 0.5, y: 0.5, w: 3, h: 2,
  fill: { color: "3b82f6" },
  line: { color: "1e40af", width: 2 },
  rectRadius: 0.2,  // rounded corners
});

// Circle
slide.addShape(pptx.ShapeType.ellipse, {
  x: 5, y: 1, w: 2, h: 2,
  fill: { color: "f59e0b" },
});

// Line
slide.addShape(pptx.ShapeType.line, {
  x: 0.5, y: 4, w: 5, h: 0,
  line: { color: "94a3b8", width: 1, dashType: "dash" },
});
```

## Images

```javascript
// From file
slide.addImage({ path: "image.png", x: 1, y: 1, w: 4, h: 3 });

// From URL
slide.addImage({ path: "https://example.com/image.png", x: 1, y: 1, w: 4, h: 3 });

// From base64
slide.addImage({ data: "data:image/png;base64,...", x: 1, y: 1, w: 4, h: 3 });

// Sizing options
slide.addImage({ path: "img.png", x: 1, y: 1, w: 4, h: 3, sizing: { type: "cover", w: 4, h: 3 } });
```

## Tables

```javascript
const rows = [
  [
    { text: "Header 1", options: { bold: true, fill: { color: "4472C4" }, color: "ffffff" } },
    { text: "Header 2", options: { bold: true, fill: { color: "4472C4" }, color: "ffffff" } },
  ],
  ["Row 1 Col 1", "Row 1 Col 2"],
  ["Row 2 Col 1", "Row 2 Col 2"],
];

slide.addTable(rows, {
  x: 0.5, y: 1.5, w: 8,
  border: { type: "solid", pt: 1, color: "cccccc" },
  colW: [4, 4],
  rowH: [0.5, 0.4, 0.4],
  fontSize: 14,
  autoPage: true,
});
```

## Charts

```javascript
const chartData = [
  { name: "Sales", labels: ["Q1", "Q2", "Q3", "Q4"], values: [100, 200, 300, 250] },
  { name: "Costs", labels: ["Q1", "Q2", "Q3", "Q4"], values: [80, 150, 200, 180] },
];

slide.addChart(pptx.ChartType.bar, chartData, {
  x: 0.5, y: 1, w: 8, h: 4,
  showTitle: true,
  title: "Quarterly Performance",
  showLegend: true,
  legendPos: "b",
  chartColors: ["3b82f6", "f59e0b"],
});
```

Chart types: `bar`, `bar3d`, `line`, `area`, `pie`, `doughnut`, `scatter`, `bubble`.

## Saving

```javascript
// To file (Node.js)
pptx.writeFile({ fileName: "output.pptx" });

// To buffer
const buffer = await pptx.write({ outputType: "nodebuffer" });
```
