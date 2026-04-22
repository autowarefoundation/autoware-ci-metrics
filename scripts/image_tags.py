"""Single source of truth for the Autoware docker image tags tracked by this repo.

Edit `DISTROS` to add/remove a ROS distribution, or `BASE_TAGS` to add/remove
a build flavor. Everything else — the flat tag list, the per-distro grouping,
the dashboard's chart series order — derives from these two lists.

Frontend (public/main.js) doesn't import this directly: it iterates the
keys of `docker_images` in github_action_data.json, which the Python side
populates in `TAGS` order.
"""

DISTROS: list[str] = ["humble", "jazzy"]

BASE_TAGS: list[str] = [
    "core-dependencies",
    "universe-dependencies",
    "universe-dependencies-cuda",
]

# Flat list, base outer / distro inner — pairs the same flavor across distros
# adjacent in the dashboard legend (e.g. core-humble next to core-jazzy).
TAGS: list[str] = [
    f"{base}-{distro}" for base in BASE_TAGS for distro in DISTROS
]

# Per-distro groups — used by docker_image_size.py to free disk between
# distros mid-run (pull all of humble, prune, then pull all of jazzy).
TAG_GROUPS: list[list[str]] = [
    [f"{base}-{distro}" for base in BASE_TAGS] for distro in DISTROS
]
