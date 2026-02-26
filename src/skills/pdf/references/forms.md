# PDF Form Filling Guide

## Reading Form Fields

```python
from pypdf import PdfReader

reader = PdfReader("form.pdf")
fields = reader.get_fields()
for name, field in fields.items():
    print(f"{name}: type={field.get('/FT')}, value={field.get('/V')}")
```

Field types:
- `/Tx` -- text field
- `/Btn` -- checkbox or radio button
- `/Ch` -- dropdown or list box

## Filling Text Fields

```python
from pypdf import PdfReader, PdfWriter

reader = PdfReader("form.pdf")
writer = PdfWriter()
writer.append(reader)

writer.update_page_form_field_values(
    writer.pages[0],
    {
        "first_name": "Jane",
        "last_name": "Doe",
        "email": "jane@example.com",
        "date": "2025-01-15",
    }
)
writer.write("filled.pdf")
```

## Filling Checkboxes

Checkbox values are typically `/Yes` or `/Off`:

```python
writer.update_page_form_field_values(
    writer.pages[0],
    {"agree_terms": "/Yes", "newsletter": "/Off"},
    auto_regenerate=False
)
```

## Filling Dropdowns

Use the exact option value from the field definition:

```python
writer.update_page_form_field_values(
    writer.pages[0],
    {"country": "United States"}
)
```

## Flattening (Make Non-Editable)

After filling, flatten to prevent further editing:

```python
for page in writer.pages:
    for annot in page.get("/Annots", []):
        annot_obj = annot.get_object()
        annot_obj.update({"/Ff": 1})  # read-only flag
```

Or use a more reliable approach -- print to PDF via a viewer, or use `pdftk`:

```bash
pdftk filled.pdf output flattened.pdf flatten
```

## Troubleshooting

- **Fields not filling**: Check field names exactly (case-sensitive). Use `get_fields()` to list them.
- **Values not visible**: Some forms need `auto_regenerate=True` (default) to rebuild appearance streams.
- **Checkboxes not toggling**: Try `/1` instead of `/Yes`, or check the field's `/AP` dictionary for the actual on-state name.
