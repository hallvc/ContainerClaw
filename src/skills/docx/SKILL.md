---
name: docx
description: "Create, read, edit, and convert Word documents (.docx). Use when the user needs to: create new documents, modify existing content, work with tracked changes, extract text, add tables/images/headers, or convert between formats."
---

# Word Document Processing

Word documents (.docx) are ZIP archives containing XML files. This skill covers both high-level creation and low-level XML editing.

## Reading Documents

### Extract text with pandoc

```bash
pandoc input.docx -t plain -o output.txt
pandoc input.docx -t markdown -o output.md
```

### Extract with Python

```python
from docx import Document

doc = Document("input.docx")
for para in doc.paragraphs:
    print(para.text)
for table in doc.tables:
    for row in table.rows:
        print([cell.text for cell in row.cells])
```

## Creating New Documents (JavaScript)

Use the `docx` npm package for creating documents from scratch:

```javascript
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        HeadingLevel, AlignmentType, Header, Footer } = require("docx");
const fs = require("fs");

const doc = new Document({
  sections: [{
    properties: {
      page: { size: { width: 12240, height: 15840 } }  // US Letter in DXA (1/20 pt)
    },
    headers: {
      default: new Header({
        children: [new Paragraph({ text: "Header Text" })]
      })
    },
    children: [
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: "Document Title", bold: true })]
      }),
      new Paragraph({
        children: [new TextRun("Body text here.")]
      })
    ]
  }]
});

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync("output.docx", buffer);
});
```

**Page sizes in DXA** (1 inch = 1440 DXA):
- US Letter: 12240 x 15840
- A4: 11906 x 16838

Install: `npm install docx`

## Editing Existing Documents

Documents are ZIP archives. To edit:

1. **Unpack**: `python scripts/unpack.py input.docx work_dir/`
2. **Edit XML**: Modify files in `work_dir/word/` (e.g., `document.xml`, `styles.xml`)
3. **Validate**: `python scripts/validate.py work_dir/`
4. **Repack**: `cd work_dir && zip -r ../output.docx . -x ".*"`

### Key XML files

| File | Purpose |
|------|---------|
| `word/document.xml` | Main document body |
| `word/styles.xml` | Style definitions |
| `word/header1.xml` | Header content |
| `word/footer1.xml` | Footer content |
| `word/_rels/document.xml.rels` | Relationships (images, etc.) |
| `[Content_Types].xml` | MIME types for all parts |

### Common XML operations

**Replace text:**
```python
import re

with open("work_dir/word/document.xml", "r") as f:
    xml = f.read()
xml = xml.replace("OLD_TEXT", "NEW_TEXT")
with open("work_dir/word/document.xml", "w") as f:
    f.write(xml)
```

**Add an image:** Add the image file to `word/media/`, update `word/_rels/document.xml.rels` with a new relationship, and reference it in `document.xml` with a `<w:drawing>` element.

## Tracked Changes

### Accept all tracked changes

```bash
python scripts/accept_changes.py input.docx output.docx
```

### Read tracked changes

```bash
pandoc input.docx -t markdown --track-changes=all
```

Options: `--track-changes=accept` (accept all), `--track-changes=reject` (reject all), `--track-changes=all` (show markup).

## Format Conversion

### .doc to .docx (requires LibreOffice)

```bash
python scripts/soffice.py convert input.doc --to docx
```

### .docx to PDF

```bash
python scripts/soffice.py convert input.docx --to pdf
```

## Dependencies

- `python-docx` -- Python reading/writing (`pip install python-docx`)
- `docx` -- JavaScript creation (`npm install docx`)
- `pandoc` -- text extraction and format conversion
- LibreOffice -- format conversion (.doc to .docx, .docx to PDF), optional
