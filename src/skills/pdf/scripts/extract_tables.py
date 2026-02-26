#!/usr/bin/env python3
"""Extract tables from a PDF file and output as CSV.

Usage:
    python extract_tables.py input.pdf
    python extract_tables.py input.pdf --pages 1,2,3
    python extract_tables.py input.pdf --output tables/
"""

import argparse
import csv
import os
import sys

try:
    import pdfplumber
except ImportError:
    print("Error: pdfplumber is required. Install with: pip install pdfplumber", file=sys.stderr)
    sys.exit(1)


def extract_tables(input_path, pages=None, output_dir=None):
    with pdfplumber.open(input_path) as pdf:
        table_count = 0
        page_range = range(len(pdf.pages))

        if pages:
            page_range = [p - 1 for p in pages if 0 < p <= len(pdf.pages)]

        for page_idx in page_range:
            page = pdf.pages[page_idx]
            tables = page.extract_tables()

            for i, table in enumerate(tables):
                table_count += 1
                if output_dir:
                    os.makedirs(output_dir, exist_ok=True)
                    output_path = os.path.join(output_dir, f"page{page_idx + 1}_table{i + 1}.csv")
                    with open(output_path, "w", newline="") as f:
                        writer = csv.writer(f)
                        for row in table:
                            writer.writerow(row)
                    print(f"  Page {page_idx + 1}, Table {i + 1} -> {output_path}")
                else:
                    print(f"\n--- Page {page_idx + 1}, Table {i + 1} ---")
                    for row in table:
                        print("\t".join(str(cell) if cell else "" for cell in row))

        print(f"\nExtracted {table_count} table(s) from {len(list(page_range))} page(s)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Extract tables from PDF")
    parser.add_argument("input", help="Input PDF file")
    parser.add_argument("--pages", help="Comma-separated page numbers (1-indexed). Default: all")
    parser.add_argument("--output", help="Output directory for CSV files. Default: print to stdout")
    args = parser.parse_args()

    page_list = None
    if args.pages:
        page_list = [int(p.strip()) for p in args.pages.split(",")]

    extract_tables(args.input, page_list, args.output)
