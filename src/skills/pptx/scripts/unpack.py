#!/usr/bin/env python3
"""Unpack a .pptx file into a directory for XML editing.

Usage:
    python unpack.py input.pptx work_dir/
"""

import os
import sys
import zipfile


def unpack_pptx(input_path, output_dir):
    if not os.path.exists(input_path):
        print(f"Error: {input_path} not found", file=sys.stderr)
        sys.exit(1)

    os.makedirs(output_dir, exist_ok=True)

    with zipfile.ZipFile(input_path, "r") as zf:
        zf.extractall(output_dir)

    # List slides
    slides_dir = os.path.join(output_dir, "ppt", "slides")
    if os.path.isdir(slides_dir):
        slides = sorted(f for f in os.listdir(slides_dir) if f.endswith(".xml"))
        print(f"Unpacked {input_path} -> {output_dir}/ ({len(slides)} slides)")
        for s in slides:
            print(f"  ppt/slides/{s}")
    else:
        print(f"Unpacked {input_path} -> {output_dir}/")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python unpack.py <input.pptx> <output_dir>", file=sys.stderr)
        sys.exit(1)
    unpack_pptx(sys.argv[1], sys.argv[2])
