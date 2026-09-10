"""Resolve recorded image digests to GitHub's numeric package-version URLs."""

import json
import pathlib
import re
from datetime import datetime, timedelta, timezone

import requests

from docker_image_size import IMAGE, ORG

VERSIONS_URL = (
    f"https://github.com/orgs/{ORG}/packages/container/{IMAGE}/versions"
)
VERSIONS_API = (
    f"https://api.github.com/orgs/{ORG}/packages/container/{IMAGE}/versions"
)
CACHE_FILE = "docker_image_version_urls.json"
MISSING_RETRY = timedelta(days=1)


def add_image_version_urls(
    images: dict, data_dir: pathlib.Path, github_token: str
) -> None:
    """Attach version links, caching immutable IDs and retrying missing versions.

    GitHub's package pages cannot select a version by digest or tag alone.
    Resolve platform digests through the package versions API instead.
    """
    cache_path = data_dir / CACHE_FILE
    cache = json.loads(cache_path.read_text()) if cache_path.exists() else {}
    now = datetime.now(timezone.utc)
    digests = {
        entry.get("digest", "")
        for entries in images.values()
        for entry in entries
        if re.fullmatch(r"sha256:[0-9a-f]{64}", entry.get("digest", ""))
    }
    pending = {
        digest
        for digest in digests
        if digest not in cache
        or (
            not cache[digest]["html_url"]
            and now - datetime.fromisoformat(cache[digest]["checked_at"])
            >= MISSING_RETRY
        )
    }
    if pending:
        headers = {
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {github_token}",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        page = 1
        lookup_failed = False
        while pending:
            try:
                response = requests.get(
                    VERSIONS_API,
                    headers=headers,
                    params={"per_page": 100, "page": page},
                    timeout=30,
                )
                response.raise_for_status()
            except requests.RequestException as error:
                print(f"Warning: retaining cached image links: {error}")
                lookup_failed = True
                break
            versions = response.json()
            for version in versions:
                digest = version["name"]
                if digest in pending:
                    cache[digest] = {
                        "html_url": version["html_url"],
                        "checked_at": now.isoformat(),
                    }
                    pending.remove(digest)
            if len(versions) < 100:
                break
            page += 1
        # Deleted versions may never resolve; avoid rescanning their history
        # on every half-hour export, but retry in case of indexing delays.
        if not lookup_failed:
            for digest in pending:
                cache[digest] = {"html_url": "", "checked_at": now.isoformat()}
        if cache:
            cache_path.write_text(
                json.dumps(cache, indent=2, sort_keys=True) + "\n"
            )

    for entries in images.values():
        for entry in entries:
            entry["html_url"] = cache.get(entry.get("digest"), {}).get(
                "html_url", ""
            )
