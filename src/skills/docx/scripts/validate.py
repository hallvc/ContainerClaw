#!/usr/bin/env python3
"""Validate an unpacked .docx directory for XML well-formedness.

Usage:
    python validate.py work_dir/
"""

import os
import sys
import xml.etree.ElementTree as ET


def validate_docx_dir(dir_path):
    if not os.path.isdir(dir_path):
        print(f"Error: {dir_path} is not a directory", file=sys.stderr)
        sys.exit(1)

    errors = []
    xml_count = 0

    for root, dirs, files in os.walk(dir_path):
        for f in files:
            if f.endswith(".xml") or f.endswith(".rels"):
                xml_count += 1
                filepath = os.path.join(root, f)
                rel = os.path.relpath(filepath, dir_path)
                try:
                    ET.parse(filepath)
                except ET.ParseError as e:
                    errors.append((rel, str(e)))

    # Check required files
    required = [
        "[Content_Types].xml",
        os.path.join("word", "document.xml"),
    ]
    for req in required:
        if not os.path.exists(os.path.join(dir_path, req)):
            errors.append((req, "Required file missing"))

    if errors:
        print(f"INVALID: {len(errors)} error(s) found:")
        for path, error in errors:
            print(f"  {path}: {error}")
        sys.exit(1)
    else:
        print(f"VALID: {xml_count} XML files checked, no errors")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python validate.py <unpacked_dir>", file=sys.stderr)
        sys.exit(1)
    validate_docx_dir(sys.argv[1])
