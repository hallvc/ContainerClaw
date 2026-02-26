#!/usr/bin/env python3
"""Unpack a .docx file into a directory for XML editing.

Usage:
    python unpack.py input.docx work_dir/
"""

import os
import sys
import zipfile


def unpack_docx(input_path, output_dir):
    if not os.path.exists(input_path):
        print(f"Error: {input_path} not found", file=sys.stderr)
        sys.exit(1)

    os.makedirs(output_dir, exist_ok=True)

    with zipfile.ZipFile(input_path, "r") as zf:
        zf.extractall(output_dir)

    print(f"Unpacked {input_path} -> {output_dir}/")
    print(f"Key files:")
    for root, dirs, files in os.walk(output_dir):
        for f in files:
            rel = os.path.relpath(os.path.join(root, f), output_dir)
            print(f"  {rel}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python unpack.py <input.docx> <output_dir>", file=sys.stderr)
        sys.exit(1)
    unpack_docx(sys.argv[1], sys.argv[2])
