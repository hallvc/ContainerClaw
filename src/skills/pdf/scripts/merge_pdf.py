#!/usr/bin/env python3
"""Merge multiple PDF files into one.

Usage:
    python merge_pdf.py output.pdf file1.pdf file2.pdf file3.pdf
"""

import argparse
import sys

try:
    from pypdf import PdfWriter
except ImportError:
    print("Error: pypdf is required. Install with: pip install pypdf", file=sys.stderr)
    sys.exit(1)


def merge_pdfs(output_path, input_paths):
    writer = PdfWriter()
    total_pages = 0

    for path in input_paths:
        writer.append(path)
        print(f"  Added: {path}")

    total_pages = len(writer.pages)
    writer.write(output_path)
    print(f"Merged {len(input_paths)} files ({total_pages} pages) -> {output_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Merge PDF files")
    parser.add_argument("output", help="Output PDF file")
    parser.add_argument("inputs", nargs="+", help="Input PDF files to merge (in order)")
    args = parser.parse_args()

    merge_pdfs(args.output, args.inputs)
