---
name: pdf
description: "Read, create, edit, merge, split, rotate, and fill PDF documents. Use when the user needs to work with PDF files: extracting text/tables, merging multiple PDFs, splitting pages, rotating, filling forms, adding watermarks, OCR, or creating new PDFs."
---

# PDF Processing

## Reading & Extracting

### Extract text (pypdf)

```python
from pypdf import PdfReader

reader = PdfReader("input.pdf")
for page in reader.pages:
    print(page.extract_text())
```

### Extract tables (pdfplumber)

```python
import pdfplumber

with pdfplumber.open("input.pdf") as pdf:
    for page in pdf.pages:
        for table in page.extract_tables():
            for row in table:
                print(row)
```

`pdfplumber` preserves layout-aware positioning. Prefer it for structured data (tables, invoices, forms). Use `pypdf` for plain text extraction.

### Get metadata

```python
from pypdf import PdfReader

reader = PdfReader("input.pdf")
print(reader.metadata)  # title, author, creation date, etc.
print(f"Pages: {len(reader.pages)}")
```

## Merging & Splitting

### Merge PDFs

Use the bundled script:

```bash
python scripts/merge_pdf.py output.pdf file1.pdf file2.pdf file3.pdf
```

Or inline:

```python
from pypdf import PdfWriter

writer = PdfWriter()
for path in ["file1.pdf", "file2.pdf"]:
    writer.append(path)
writer.write("merged.pdf")
```

### Split pages

```python
from pypdf import PdfReader, PdfWriter

reader = PdfReader("input.pdf")
for i, page in enumerate(reader.pages):
    writer = PdfWriter()
    writer.add_page(page)
    writer.write(f"page_{i + 1}.pdf")
```

### Extract page range

```python
from pypdf import PdfReader, PdfWriter

reader = PdfReader("input.pdf")
writer = PdfWriter()
for page in reader.pages[2:5]:  # pages 3-5 (0-indexed)
    writer.add_page(page)
writer.write("subset.pdf")
```

## Rotating Pages

Use the bundled script:

```bash
python scripts/rotate_pdf.py input.pdf output.pdf 90   # rotate all pages 90 degrees
python scripts/rotate_pdf.py input.pdf output.pdf 180 --pages 1,3,5  # specific pages
```

## Watermarks

```python
from pypdf import PdfReader, PdfWriter

reader = PdfReader("input.pdf")
watermark = PdfReader("watermark.pdf").pages[0]
writer = PdfWriter()

for page in reader.pages:
    page.merge_page(watermark)
    writer.add_page(page)
writer.write("watermarked.pdf")
```

## Form Filling

See [references/forms.md](references/forms.md) for the complete form filling guide, including:
- Reading form field names and types
- Filling text fields, checkboxes, dropdowns
- Flattening filled forms

## Creating PDFs

For creating PDFs from scratch, see [references/advanced.md](references/advanced.md) for JavaScript library options and Python alternatives.

## OCR (Scanned PDFs)

For scanned documents without selectable text:

```bash
# Using ocrmypdf (pip install ocrmypdf)
ocrmypdf input.pdf output.pdf --rotate-pages --deskew --clean
```

## Encryption & Decryption

```python
from pypdf import PdfReader, PdfWriter

# Decrypt
reader = PdfReader("encrypted.pdf")
reader.decrypt("password")

# Encrypt
writer = PdfWriter()
writer.append_pages_from_reader(reader)
writer.encrypt("new_password")
writer.write("re-encrypted.pdf")
```

## Image Extraction

```python
from pypdf import PdfReader

reader = PdfReader("input.pdf")
for page in reader.pages:
    for image in page.images:
        with open(image.name, "wb") as f:
            f.write(image.data)
```

## Dependencies

- `pypdf` -- core PDF operations (read, write, merge, split, rotate, encrypt)
- `pdfplumber` -- layout-aware text and table extraction
- `ocrmypdf` -- OCR for scanned documents (optional)

Install: `pip install pypdf pdfplumber`
