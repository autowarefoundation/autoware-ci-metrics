#!/usr/bin/env python3
"""Check which docker image tags have changed digests since the last JSONL entry.

Fetches the amd64 manifest digest for each canonical tag from GHCR (cheap —
no image pulls) and compares it against the digest on the most recent
JSONL entry for that tag in the data-storage directory. Emits the list of
tags whose digest differs so the workflow can skip the expensive pull /
measure step when nothing upstream has changed.

When run inside GitHub Actions ($GITHUB_OUTPUT set), writes:
  changed-tags=<comma-separated tag list, may be empty>
  should-measure=<true|false>
"""

import argparse
import json
import os
import pathlib
import sys

from docker_image_size import (
    IMAGE,
    ORG,
    REGISTRY_URL,
    get_auth_token,
    get_compressed_size,
)

CANONICAL_TAGS = [
    "core-dependencies-humble",
    "universe-dependencies-humble",
    "universe-dependencies-cuda-humble",
    "core-dependencies-jazzy",
    "universe-dependencies-jazzy",
    "universe-dependencies-cuda-jazzy",
]


def latest_recorded_digest(data_dir: pathlib.Path, tag: str) -> str:
    """Return the digest of the most recent JSONL entry for tag, or '' if none."""
    latest_at = ""
    latest_digest = ""
    for path in sorted(data_dir.glob("docker_image_sizes-*.jsonl")):
        with path.open() as f:
            for line in f:
                entry = json.loads(line)
                if entry.get("tag") != tag:
                    continue
                fa = entry.get("fetched_at", "")
                if fa > latest_at:
                    latest_at = fa
                    latest_digest = entry.get("digest", "")
    return latest_digest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", required=True, type=pathlib.Path)
    parser.add_argument("--github-token", default="")
    args = parser.parse_args()

    try:
        token = get_auth_token(args.github_token)
    except Exception as e:
        print(f"Warning: failed to obtain registry token: {e}")
        token = ""

    image = f"{REGISTRY_URL}/v2/{ORG}/{IMAGE}"
    changed = []
    for tag in CANONICAL_TAGS:
        # Reuse the manifest fetcher; throw away size/layer count, keep digest.
        _, _, current = get_compressed_size(image, tag, token)
        recorded = latest_recorded_digest(args.data_dir, tag)
        is_changed = current != recorded
        marker = "CHANGED" if is_changed else "same   "
        print(f"  {marker}  {tag}")
        print(f"      current : {current[:23] if current else '(unavailable)'}")
        print(f"      recorded: {recorded[:23] if recorded else '(none)'}")
        if is_changed:
            changed.append(tag)

    print(f"\n{len(changed)}/{len(CANONICAL_TAGS)} tags need measurement")

    out_path = os.environ.get("GITHUB_OUTPUT")
    if out_path:
        with open(out_path, "a") as f:
            f.write(f"changed-tags={','.join(changed)}\n")
            f.write(f"should-measure={'true' if changed else 'false'}\n")

    return 0


if __name__ == "__main__":
    sys.exit(main())
