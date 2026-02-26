# Advanced PDF Operations

## Creating PDFs with JavaScript

### jsPDF (simple documents)

```javascript
const { jsPDF } = require("jspdf");

const doc = new jsPDF();
doc.setFontSize(24);
doc.text("Hello World", 20, 30);
doc.setFontSize(12);
doc.text("Body text here.", 20, 50);
doc.save("output.pdf");
```

Install: `npm install jspdf`

### PDFKit (complex documents)

```javascript
const PDFDocument = require("pdfkit");
const fs = require("fs");

const doc = new PDFDocument({ size: "A4", margin: 50 });
doc.pipe(fs.createWriteStream("output.pdf"));

doc.fontSize(24).text("Title", { align: "center" });
doc.moveDown();
doc.fontSize(12).text("Body text with automatic word wrapping.");

// Add image
doc.image("logo.png", { width: 100 });

// Add table-like layout
doc.text("Column 1", 50, 200);
doc.text("Column 2", 250, 200);

doc.end();
```

Install: `npm install pdfkit`

## Creating PDFs with Python

### reportlab

```python
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

c = canvas.Canvas("output.pdf", pagesize=A4)
width, height = A4

c.setFont("Helvetica-Bold", 24)
c.drawString(72, height - 72, "Title")

c.setFont("Helvetica", 12)
c.drawString(72, height - 120, "Body text.")

c.save()
```

Install: `pip install reportlab`

## Extracting Images

```python
from pypdf import PdfReader
import os

reader = PdfReader("input.pdf")
os.makedirs("images", exist_ok=True)

count = 0
for page in reader.pages:
    for image in page.images:
        count += 1
        with open(f"images/image_{count}_{image.name}", "wb") as f:
            f.write(image.data)
print(f"Extracted {count} images")
```

## PDF Metadata

### Read metadata

```python
reader = PdfReader("input.pdf")
meta = reader.metadata
print(f"Title: {meta.title}")
print(f"Author: {meta.author}")
print(f"Pages: {len(reader.pages)}")
```

### Set metadata

```python
from pypdf import PdfWriter

writer = PdfWriter()
writer.append("input.pdf")
writer.add_metadata({
    "/Title": "Document Title",
    "/Author": "Author Name",
    "/Subject": "Subject",
})
writer.write("output.pdf")
```

## Page Manipulation

### Add blank pages

```python
from pypdf import PdfWriter
from pypdf._page import PageObject

writer = PdfWriter()
writer.append("input.pdf")

# Add blank A4 page
blank = PageObject.create_blank_page(width=595.276, height=841.89)
writer.add_page(blank)

writer.write("output.pdf")
```

### Crop pages

```python
from pypdf import PdfReader, PdfWriter

reader = PdfReader("input.pdf")
writer = PdfWriter()

for page in reader.pages:
    # Crop to center half
    page.mediabox.lower_left = (100, 100)
    page.mediabox.upper_right = (500, 700)
    writer.add_page(page)

writer.write("cropped.pdf")
```
