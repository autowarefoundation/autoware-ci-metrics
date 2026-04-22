#!/usr/bin/env python3
"""One-shot migration: collapse per-run docker_image_sizes_*.json into yearly JSONL.

For each docker_image_sizes_*.json in --input-dir:
  - Parse the file
  - Filter `images[]` to canonical tags only (drops legacy *-devel entries)
  - Drop entries with errors or no usable size data
  - Bucket surviving entries by year of `fetched_at`

Writes one `docker_image_sizes-YYYY.jsonl` per year to --output-dir, sorted
by fetched_at, one JSON object per line. With --delete-old, removes the
source per-run files after writing.
"""

import argparse
import json
import pathlib
import sys
from collections import defaultdict
from datetime import datetime

CANONICAL_TAGS = {
    "core-dependencies-humble",
    "universe-dependencies-humble",
    "universe-dependencies-cuda-humble",
    "core-dependencies-jazzy",
    "universe-dependencies-jazzy",
    "universe-dependencies-cuda-jazzy",
}


def to_jsonl_line(entry: dict) -> dict:
    return {
        "tag": entry["tag"],
        "fetched_at": entry["fetched_at"],
        "compressed_size_bytes": entry.get("compressed_size_bytes", 0),
        "uncompressed_size_bytes": entry.get("uncompressed_size_bytes", 0),
        "num_layers": entry.get("num_layers", 0),
        "digest": entry.get("digest", ""),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", required=True, type=pathlib.Path)
    parser.add_argument("--output-dir", required=True, type=pathlib.Path)
    parser.add_argument(
        "--delete-old",
        action="store_true",
        help="Delete source docker_image_sizes_*.json files after writing JSONL.",
    )
    args = parser.parse_args()

    src_files = sorted(args.input_dir.glob("docker_image_sizes_*.json"))
    if not src_files:
        print(f"No docker_image_sizes_*.json files in {args.input_dir}")
        return 1

    by_year: dict[int, list[dict]] = defaultdict(list)
    counts = {"kept": 0, "dropped_unknown_tag": 0, "dropped_error": 0, "dropped_no_size": 0}
    dropped_tags: dict[str, int] = defaultdict(int)

    for src in src_files:
        with src.open() as f:
            payload = json.load(f)
        for entry in payload.get("images", []):
            tag = entry.get("tag", "")
            if tag not in CANONICAL_TAGS:
                counts["dropped_unknown_tag"] += 1
                dropped_tags[tag] += 1
                continue
            if "error" in entry:
                counts["dropped_error"] += 1
                continue
            if not entry.get("compressed_size_bytes") and not entry.get(
                "uncompressed_size_bytes"
            ):
                counts["dropped_no_size"] += 1
                continue
            year = datetime.fromisoformat(entry["fetched_at"]).year
            by_year[year].append(to_jsonl_line(entry))
            counts["kept"] += 1

    args.output_dir.mkdir(parents=True, exist_ok=True)
    for year, entries in sorted(by_year.items()):
        entries.sort(key=lambda e: e["fetched_at"])
        out_path = args.output_dir / f"docker_image_sizes-{year}.jsonl"
        with out_path.open("w") as f:
            for entry in entries:
                f.write(json.dumps(entry) + "\n")
        print(f"  wrote {out_path} ({len(entries)} lines)")

    print()
    print(f"Source files: {len(src_files)}")
    print(f"Kept:         {counts['kept']}")
    print(f"Dropped:")
    print(f"  unknown tag: {counts['dropped_unknown_tag']}")
    if dropped_tags:
        for tag, n in sorted(dropped_tags.items(), key=lambda kv: -kv[1]):
            print(f"    {tag}: {n}")
    print(f"  error:       {counts['dropped_error']}")
    print(f"  no size:     {counts['dropped_no_size']}")

    if args.delete_old:
        for src in src_files:
            src.unlink()
        print(f"\nDeleted {len(src_files)} source files.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
