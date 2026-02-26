#!/usr/bin/env python3
"""Recalculate formulas in an Excel file using LibreOffice.

Usage:
    python recalc.py input.xlsx output.xlsx
"""

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


def recalculate(input_path, output_path):
    soffice = find_soffice()
    if not soffice:
        print("Error: LibreOffice not found. Install from https://www.libreoffice.org/", file=sys.stderr)
        sys.exit(1)

    if not os.path.exists(input_path):
        print(f"Error: {input_path} not found", file=sys.stderr)
        sys.exit(1)

    with tempfile.TemporaryDirectory() as tmpdir:
        # Copy input to temp dir
        tmp_input = os.path.join(tmpdir, os.path.basename(input_path))
        shutil.copy2(input_path, tmp_input)

        # Use LibreOffice macro to recalculate and save
        macro = (
            'macro:///Standard.Module1.Recalc'
        )

        # Simple approach: convert to xlsx (forces recalculation)
        cmd = [
            soffice,
            "--headless",
            "--calc",
            "--convert-to", "xlsx",
            "--outdir", tmpdir,
            tmp_input,
        ]

        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)

        if result.returncode != 0:
            print(f"Error: {result.stderr}", file=sys.stderr)
            sys.exit(1)

        # Find output file
        basename = os.path.splitext(os.path.basename(input_path))[0]
        recalced = os.path.join(tmpdir, f"{basename}.xlsx")

        if os.path.exists(recalced):
            shutil.copy2(recalced, output_path)
            print(f"Recalculated: {input_path} -> {output_path}")
        else:
            print("Error: Recalculation produced no output", file=sys.stderr)
            sys.exit(1)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python recalc.py <input.xlsx> <output.xlsx>", file=sys.stderr)
        sys.exit(1)
    recalculate(sys.argv[1], sys.argv[2])
