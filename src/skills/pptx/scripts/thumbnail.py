#!/usr/bin/env python3
"""Generate thumbnail images from PowerPoint slides.

Requires LibreOffice for conversion.

Usage:
    python thumbnail.py input.pptx --output thumbs/
    python thumbnail.py input.pptx --output thumbs/ --size 800x600
"""

import argparse
import os
import shutil
import subprocess
import sys
import tempfile


def find_soffice():
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


def generate_thumbnails(input_path, output_dir, size=None):
    soffice = find_soffice()
    if not soffice:
        print("Error: LibreOffice not found. Install from https://www.libreoffice.org/", file=sys.stderr)
        sys.exit(1)

    os.makedirs(output_dir, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmpdir:
        # Convert to images via PDF first
        cmd = [soffice, "--headless", "--convert-to", "pdf", "--outdir", tmpdir, input_path]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if result.returncode != 0:
            print(f"Error converting to PDF: {result.stderr}", file=sys.stderr)
            sys.exit(1)

        basename = os.path.splitext(os.path.basename(input_path))[0]
        pdf_path = os.path.join(tmpdir, f"{basename}.pdf")

        if not os.path.exists(pdf_path):
            print("Error: PDF conversion produced no output", file=sys.stderr)
            sys.exit(1)

        # Try to use pdftoppm for page images
        if shutil.which("pdftoppm"):
            cmd = ["pdftoppm", "-png"]
            if size:
                w, h = size.split("x")
                cmd.extend(["-scale-to-x", w, "-scale-to-y", h])
            cmd.extend([pdf_path, os.path.join(output_dir, "slide")])
            subprocess.run(cmd, check=True, timeout=120)
            print(f"Thumbnails generated in {output_dir}/")
        else:
            # Fallback: just provide the PDF
            shutil.copy2(pdf_path, os.path.join(output_dir, f"{basename}.pdf"))
            print(f"PDF saved to {output_dir}/{basename}.pdf (install poppler-utils for per-slide PNGs)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate slide thumbnails")
    parser.add_argument("input", help="Input PPTX file")
    parser.add_argument("--output", default="thumbnails/", help="Output directory")
    parser.add_argument("--size", help="Thumbnail size WxH (e.g., 800x600)")
    args = parser.parse_args()

    generate_thumbnails(args.input, args.output, args.size)
