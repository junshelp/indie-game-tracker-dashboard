#!/usr/bin/env python3
"""Reject invalid dashboard data before committing or publishing."""
import argparse
from tracker_common import validate_bundle

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("data_dir")
    args = parser.parse_args()
    print(f"Validated {validate_bundle(args.data_dir)} events and available Steam data")
