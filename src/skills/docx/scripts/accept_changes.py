#!/usr/bin/env python3
"""Accept all tracked changes in a .docx file.

Usage:
    python accept_changes.py input.docx output.docx
"""

import os
import re
import shutil
import sys
import tempfile
import zipfile


def accept_changes(input_path, output_path):
    if not os.path.exists(input_path):
        print(f"Error: {input_path} not found", file=sys.stderr)
        sys.exit(1)

    with tempfile.TemporaryDirectory() as tmpdir:
        # Unpack
        with zipfile.ZipFile(input_path, "r") as zf:
            zf.extractall(tmpdir)

        doc_path = os.path.join(tmpdir, "word", "document.xml")
        if not os.path.exists(doc_path):
            print("Error: word/document.xml not found in archive", file=sys.stderr)
            sys.exit(1)

        with open(doc_path, "r", encoding="utf-8") as f:
            content = f.read()

        # Accept insertions: keep content inside <w:ins> tags
        content = re.sub(r"<w:ins\b[^>]*>(.*?)</w:ins>", r"\1", content, flags=re.DOTALL)

        # Accept deletions: remove content inside <w:del> tags
        content = re.sub(r"<w:del\b[^>]*>.*?</w:del>", "", content, flags=re.DOTALL)

        # Remove revision properties
        content = re.sub(r"<w:rPrChange\b[^>]*>.*?</w:rPrChange>", "", content, flags=re.DOTALL)
        content = re.sub(r"<w:pPrChange\b[^>]*>.*?</w:pPrChange>", "", content, flags=re.DOTALL)
        content = re.sub(r"<w:sectPrChange\b[^>]*>.*?</w:sectPrChange>", "", content, flags=re.DOTALL)

        with open(doc_path, "w", encoding="utf-8") as f:
            f.write(content)

        # Repack
        with zipfile.ZipFile(output_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for root, dirs, files in os.walk(tmpdir):
                for file in files:
                    filepath = os.path.join(root, file)
                    arcname = os.path.relpath(filepath, tmpdir)
                    zf.write(filepath, arcname)

    print(f"Accepted all tracked changes: {input_path} -> {output_path}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python accept_changes.py <input.docx> <output.docx>", file=sys.stderr)
        sys.exit(1)
    accept_changes(sys.argv[1], sys.argv[2])
