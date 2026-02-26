#!/usr/bin/env python3
"""Rotate pages in a PDF file.

Usage:
    python rotate_pdf.py input.pdf output.pdf 90
    python rotate_pdf.py input.pdf output.pdf 180 --pages 1,3,5
"""

import argparse
import sys

try:
    from pypdf import PdfReader, PdfWriter
except ImportError:
    print("Error: pypdf is required. Install with: pip install pypdf", file=sys.stderr)
    sys.exit(1)


def rotate_pdf(input_path, output_path, degrees, pages=None):
    reader = PdfReader(input_path)
    writer = PdfWriter()

    for i, page in enumerate(reader.pages):
        if pages is None or (i + 1) in pages:
            page.rotate(degrees)
        writer.add_page(page)

    writer.write(output_path)
    print(f"Rotated {len(pages) if pages else len(reader.pages)} page(s) by {degrees} degrees -> {output_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Rotate PDF pages")
    parser.add_argument("input", help="Input PDF file")
    parser.add_argument("output", help="Output PDF file")
    parser.add_argument("degrees", type=int, choices=[90, 180, 270], help="Rotation degrees (clockwise)")
    parser.add_argument("--pages", help="Comma-separated page numbers to rotate (1-indexed). Default: all pages")
    args = parser.parse_args()

    page_list = None
    if args.pages:
        page_list = [int(p.strip()) for p in args.pages.split(",")]

    rotate_pdf(args.input, args.output, args.degrees, page_list)
