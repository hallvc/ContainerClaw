#!/usr/bin/env python3
"""LibreOffice wrapper for document conversion.

Usage:
    python soffice.py convert input.docx --to pdf
    python soffice.py convert input.doc --to docx
"""

import argparse
import os
import shutil
import subprocess
import sys


def find_soffice():
    """Find LibreOffice binary."""
    candidates = [
        "soffice",
        "/Applications/LibreOffice.app/Contents/MacOS/soffice",
        "/usr/bin/soffice",
        "/usr/local/bin/soffice",
    ]
    for candidate in candidates:
        if shutil.which(candidate):
            return candidate
    return None


def convert(input_path, to_format, output_dir=None):
    soffice = find_soffice()
    if not soffice:
        print("Error: LibreOffice not found. Install from https://www.libreoffice.org/", file=sys.stderr)
        sys.exit(1)

    if not os.path.exists(input_path):
        print(f"Error: {input_path} not found", file=sys.stderr)
        sys.exit(1)

    if output_dir is None:
        output_dir = os.path.dirname(input_path) or "."

    cmd = [
        soffice,
        "--headless",
        "--convert-to", to_format,
        "--outdir", output_dir,
        input_path,
    ]

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)

    if result.returncode != 0:
        print(f"Error: {result.stderr}", file=sys.stderr)
        sys.exit(1)

    basename = os.path.splitext(os.path.basename(input_path))[0]
    output_path = os.path.join(output_dir, f"{basename}.{to_format}")
    print(f"Converted: {input_path} -> {output_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="LibreOffice document converter")
    sub = parser.add_subparsers(dest="command")

    convert_parser = sub.add_parser("convert", help="Convert document format")
    convert_parser.add_argument("input", help="Input file")
    convert_parser.add_argument("--to", required=True, help="Target format (pdf, docx, doc, odt, etc.)")
    convert_parser.add_argument("--outdir", help="Output directory (default: same as input)")

    args = parser.parse_args()
    if args.command == "convert":
        convert(args.input, args.to, args.outdir)
    else:
        parser.print_help()
