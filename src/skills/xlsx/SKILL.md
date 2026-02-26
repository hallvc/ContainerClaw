---
name: xlsx
description: "Create, read, edit, and analyze spreadsheets (.xlsx, .xlsm, .csv, .tsv). Use when the user needs to: create Excel files, analyze tabular data, build financial models, write formulas, format cells, or clean messy data."
---

# Spreadsheet Processing

## Reading & Analyzing

### Quick analysis with pandas

```python
import pandas as pd

df = pd.read_excel("input.xlsx", sheet_name="Sheet1")
print(df.describe())
print(df.head(20))
```

### Read with openpyxl (preserves formatting)

```python
from openpyxl import load_workbook

wb = load_workbook("input.xlsx", data_only=True)
ws = wb.active
for row in ws.iter_rows(values_only=True):
    print(row)
```

Use `data_only=True` to read calculated values instead of formulas. Without it, you get formula strings.

### Read CSV/TSV

```python
import pandas as pd

df = pd.read_csv("data.csv")
df = pd.read_csv("data.tsv", sep="\t")
```

## Creating Spreadsheets

### With openpyxl

```python
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, numbers

wb = Workbook()
ws = wb.active
ws.title = "Report"

# Headers
headers = ["Name", "Revenue", "Growth"]
for col, header in enumerate(headers, 1):
    cell = ws.cell(row=1, column=col, value=header)
    cell.font = Font(bold=True, size=12)
    cell.fill = PatternFill("solid", fgColor="4472C4")
    cell.font = Font(bold=True, color="FFFFFF")

# Data
ws.append(["Product A", 150000, 0.12])
ws.append(["Product B", 230000, 0.08])

# Format currency
for row in ws.iter_rows(min_row=2, min_col=2, max_col=2):
    for cell in row:
        cell.number_format = '$#,##0'

# Format percentage
for row in ws.iter_rows(min_row=2, min_col=3, max_col=3):
    for cell in row:
        cell.number_format = '0.0%'

# Formulas
ws["B4"] = "=SUM(B2:B3)"
ws["C4"] = "=AVERAGE(C2:C3)"

# Column widths
ws.column_dimensions["A"].width = 20
ws.column_dimensions["B"].width = 15

wb.save("output.xlsx")
```

## Formulas

### Common formulas

```python
ws["B10"] = "=SUM(B2:B9)"
ws["C10"] = "=AVERAGE(C2:C9)"
ws["D2"] = '=IF(C2>0.1,"High","Low")'
ws["E2"] = "=VLOOKUP(A2,Sheet2!A:B,2,FALSE)"
ws["F2"] = '=COUNTIF(C2:C100,">0.1")'
```

### Recalculate formulas

Openpyxl does not evaluate formulas. To recalculate:

```bash
python scripts/recalc.py input.xlsx output.xlsx
```

Requires LibreOffice installed.

## Financial Modeling Conventions

When building financial models, follow these standards:

### Color coding

| Color | Meaning | Example |
|-------|---------|---------|
| Blue text | Input/assumption (hardcoded) | Revenue growth rate |
| Black text | Formula (calculated) | Total revenue |
| Green text | Cross-sheet reference | Revenue from Summary sheet |
| Red text | External data link | Market data feed |
| Yellow fill | Key assumption cell | Discount rate |

### Number formatting

- **Currency**: `$#,##0` or `$#,##0.00`
- **Percentages**: `0.0%` or `0.00%`
- **Multiples**: `0.0x`
- **Negative numbers**: `($#,##0)` (parentheses, not minus)
- **Dates**: `YYYY-MM-DD` or `MMM-YY`

### Best practices

- Assumptions in separate cells, never embedded in formulas
- Cell references over hardcoded values
- Document any hardcoded value with a source citation comment
- One row per time period, one column per metric (or transposed -- be consistent)
- Summary/dashboard sheet first, detail sheets after

## Data Cleaning

```python
import pandas as pd

df = pd.read_excel("messy.xlsx")

# Remove empty rows
df = df.dropna(how="all")

# Normalize column names
df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]

# Fix data types
df["date"] = pd.to_datetime(df["date"], errors="coerce")
df["amount"] = pd.to_numeric(df["amount"], errors="coerce")

# Remove duplicates
df = df.drop_duplicates()

# Write clean version
df.to_excel("clean.xlsx", index=False)
```

## Dependencies

- `openpyxl` -- Excel read/write with formatting (`pip install openpyxl`)
- `pandas` -- data analysis and CSV/Excel I/O (`pip install pandas`)
- LibreOffice -- formula recalculation (optional)
