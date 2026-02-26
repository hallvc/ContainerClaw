# Editing Existing PPTX Files

## Structure

A .pptx file is a ZIP archive:

```
[Content_Types].xml
_rels/.rels
ppt/
  presentation.xml          -- Slide order and relationships
  slides/
    slide1.xml              -- Individual slide content
    slide2.xml
    _rels/
      slide1.xml.rels       -- Slide relationships (images, etc.)
  slideMasters/             -- Master slide templates
  slideLayouts/             -- Layout templates
  media/                    -- Images and embedded files
  theme/                    -- Theme definitions (colors, fonts)
```

## Workflow

1. Unpack: `python scripts/unpack.py input.pptx work_dir/`
2. Edit XML files in `work_dir/ppt/slides/`
3. Repack: `cd work_dir && zip -r ../output.pptx . -x ".*"`

## Common Operations

### Replace text in a slide

```python
import os

slide_path = "work_dir/ppt/slides/slide1.xml"
with open(slide_path, "r", encoding="utf-8") as f:
    content = f.read()

content = content.replace("OLD TEXT", "NEW TEXT")

with open(slide_path, "w", encoding="utf-8") as f:
    f.write(content)
```

**Note:** Text in PPTX XML is split across `<a:r>` (run) elements. A single visible word may span multiple runs. For reliable text replacement, use the approach below:

```python
import re

# Find text spans that may be split across runs
# Example: "Hello" might be <a:r><a:t>Hel</a:t></a:r><a:r><a:t>lo</a:t></a:r>

# Simple approach: concatenate all <a:t> in a paragraph, replace, set in first run
```

### Add a slide

1. Create a new `slideN.xml` in `ppt/slides/`
2. Create a relationship file in `ppt/slides/_rels/slideN.xml.rels`
3. Add the slide to `ppt/presentation.xml` (in `<p:sldIdLst>`)
4. Add the slide to `[Content_Types].xml`
5. Add a relationship in `ppt/_rels/presentation.xml.rels`

### Replace an image

1. Add the new image to `ppt/media/` (e.g., `image_new.png`)
2. Update the relationship in `ppt/slides/_rels/slideN.xml.rels` to point to the new file
3. Or simply replace the file at `ppt/media/imageN.ext` with the same filename

### Change theme colors

Edit `ppt/theme/theme1.xml`:

```xml
<a:dk1><a:srgbClr val="1a1a2e"/></a:dk1>  <!-- Dark 1 -->
<a:lt1><a:srgbClr val="f8fafc"/></a:lt1>  <!-- Light 1 -->
<a:accent1><a:srgbClr val="3b82f6"/></a:accent1>
```

## Repacking

```bash
cd work_dir
zip -r ../output.pptx . -x ".*" -x "__MACOSX/*"
```

The `-x ".*"` excludes hidden files (like `.DS_Store`).
