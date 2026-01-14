import argparse
import json
import os
import pathlib
from datetime import datetime, timezone

import requests
from subprocess import run, PIPE

REGISTRY = "ghcr.io"
REGISTRY_URL = f"http://{REGISTRY}"
ORG = "autowarefoundation"
IMAGE = "autoware"
TAGS = ["universe-devel", "universe-devel-cuda", "core-devel"]
OUTPUT_DIR = "data/docker_image_sizes"
OUTPUT_FILE_TEMPLATE = "docker_image_sizes_{timestamp}.json"


def get_auth_token(github_token: str = "") -> str:
    """Get authentication token from GitHub Container Registry.

    If github_token is provided, exchange it for a registry access token with pull scope.
    Otherwise, request an anonymous token.
    """
    url = (
        f"{REGISTRY_URL}/token?service=ghcr.io"
        f"&scope=repository:{ORG}/{IMAGE}:pull"
    )
    headers = {}
    if github_token:
        print("Exchanging GitHub token for registry access token")
        headers["Authorization"] = f"Bearer {github_token}"
        headers["Accept"] = "application/json"
        print("Requesting access token with pull scope")
        print("Headers:", headers)
    else:
        print("Requesting anonymous access token")

    response = requests.get(url, headers=headers, timeout=30)
    response.raise_for_status()
    data = response.json()
    return data.get("token", "")


def get_compressed_size(image: str, tag: str, token: str) -> tuple[int, int]:
    """Get the compressed size of a Docker image from registry manifest.

    Returns a tuple of (compressed_size_bytes, num_layers).
    """
    try:
        headers = {
            "Authorization": f"Bearer {token}",
        }

        # Get manifest list (handles multi-arch images)
        manifest_list_url = f"{image}/manifests/{tag}"
        headers_list = headers.copy()
        headers_list["Accept"] = (
            "application/vnd.docker.distribution.manifest.list.v2+json"
        )

        response = requests.get(
            manifest_list_url, headers=headers_list, timeout=30
        )
        response.raise_for_status()
        manifest_list = response.json()

        # Get the amd64 manifest (use first amd64 architecture)
        amd64_manifest = None
        amd64_digest = None

        # Handle both manifest list and direct manifest
        if manifest_list.get("mediaType") == (
            "application/vnd.docker.distribution.manifest.list.v2+json"
        ):
            for m in manifest_list.get("manifests", []):
                if m.get("platform", {}).get("architecture") == "amd64":
                    amd64_digest = m["digest"]
                    break

            if not amd64_digest:
                # Fallback to first manifest if no amd64
                amd64_digest = manifest_list["manifests"][0]["digest"]
        else:
            # Already a direct manifest, not a list
            amd64_manifest = manifest_list
            amd64_digest = None

        # Fetch the actual manifest if we have a digest
        if amd64_digest:
            headers_manifest = headers.copy()
            headers_manifest["Accept"] = (
                "application/vnd.docker.distribution.manifest.v2+json"
            )
            response = requests.get(
                f"{image}/manifests/{amd64_digest}",
                headers=headers_manifest,
                timeout=30,
            )
            response.raise_for_status()
            amd64_manifest = response.json()

        if not amd64_manifest:
            raise ValueError("Failed to retrieve manifest")

        # Get manifest layer sizes (compressed)
        total_compressed = 0
        layers = amd64_manifest.get("layers", [])
        for layer in layers:
            total_compressed += layer.get("size", 0)

        print(f"Compressed size for {tag}: {total_compressed} bytes ({len(layers)} layers)")
        return total_compressed, len(layers)

    except Exception as e:
        print(f"Warning: Failed to get compressed size for {tag}: {e}")
        return 0, 0


def get_uncompressed_size(image: str, tag: str) -> int:
    """Get the uncompressed size of a Docker image by pulling it.

    Tries docker first, falls back to podman if docker is not available.
    Returns size in bytes, or 0 if unable to determine.
    """
    image_ref = f"{image}:{tag}"
    for cmd in ["docker", "podman"]:
        try:
            # Check if command is available
            check_result = run([cmd, "--version"], stdout=PIPE, stderr=PIPE, timeout=5)
            if check_result.returncode != 0:
                continue

            print(f"Using {cmd} to pull image {image_ref}")

            # Pull the image
            pull_result = run(
                [cmd, "pull", "--platform", "linux/amd64", image_ref],
                stdout=PIPE, stderr=PIPE, timeout=600, text=True
            )

            if pull_result.returncode != 0:
                print(f"Warning: Failed to pull image with {cmd}: {pull_result.stderr}")
                continue

            # Get image size using inspect
            inspect_result = run(
                [cmd, "inspect", image_ref],
                stdout=PIPE, stderr=PIPE, timeout=30, text=True
            )

            if inspect_result.returncode != 0:
                print(f"Warning: Failed to inspect image with {cmd}: {inspect_result.stderr}")
                continue

            inspect_data = json.loads(inspect_result.stdout)
            if not inspect_data:
                continue

            # Get Size field (uncompressed size)
            size = inspect_data[0].get("Size", 0)

            # Clean up the image
            run([cmd, "rmi", image_ref], stdout=PIPE, stderr=PIPE, timeout=30)

            print(f"Uncompressed size for {image_ref}: {size} bytes")
            return size

        except Exception as e:
            print(f"Warning: Error with {cmd}: {e}")
            continue

    print(f"Warning: Unable to determine uncompressed size for {image_ref}")
    return 0


def get_image_size(token: str, tag: str, username: str) -> dict:
    """Get the compressed and uncompressed size of a Docker image."""
    try:
        # Get compressed size from registry manifest
        image = f"{REGISTRY_URL}/v2/{ORG}/{IMAGE}"
        compressed_size, num_layers = get_compressed_size(image, tag, token)

        # Get uncompressed size by pulling the image
        image = f"{REGISTRY}/{ORG}/{IMAGE}"
        uncompressed_size = get_uncompressed_size(image, tag)

        return {
            "tag": tag,
            "compressed_size_bytes": compressed_size,
            "compressed_size_gb": round(
                compressed_size / (1024**3), 2
            ),
            "uncompressed_size_bytes": uncompressed_size,
            "uncompressed_size_gb": round(
                uncompressed_size / (1024**3), 2
            ),
            "num_layers": num_layers,
            "fetched_at": (
                datetime.now(timezone.utc).isoformat()
            ),
        }
    except Exception as e:
        print(f"Error fetching size for {tag}: {e}")
        return {
            "tag": tag,
            "error": str(e),
            "fetched_at": (
                datetime.now(timezone.utc).isoformat()
            ),
        }


def has_new_data(current_results: dict) -> bool:
    """Check if current results differ from the most recent previous results."""
    output_dir = pathlib.Path(OUTPUT_DIR)
    if not output_dir.exists():
        return True

    # Find the most recent results file
    json_files = sorted(output_dir.glob("docker_image_sizes_*.json"), reverse=True)
    if not json_files:
        return True

    try:
        with open(json_files[0], "r") as f:
            previous_results = json.load(f)

        # Compare image data (ignore timestamp and fetched_at)
        current_images = current_results.get("images", [])
        previous_images = previous_results.get("images", [])

        if len(current_images) != len(previous_images):
            return True

        for current, previous in zip(current_images, previous_images):
            # Compare compressed/uncompressed sizes and layer counts
            if (
                current.get("compressed_size_bytes") != previous.get("compressed_size_bytes")
                or current.get("uncompressed_size_bytes") != previous.get("uncompressed_size_bytes")
                or current.get("num_layers") != previous.get("num_layers")
                or "error" in current != "error" in previous
            ):
                return True

        return False
    except Exception as e:
        print(f"Warning: Could not read previous results: {e}")
        return True


def git_commit_results(file_path: str) -> bool:
    """Commit the results file to git."""
    try:
        # Configure git if needed
        run(["git", "config", "user.email", "github-actions@github.com"], check=True)
        run(["git", "config", "user.name", "github-actions"], check=True)

        # Add the file
        run(["git", "add", file_path], check=True)

        # Get a timestamp for the commit message
        timestamp = datetime.now(timezone.utc).isoformat()
        commit_message = f"Update docker image sizes - {timestamp}"

        # Commit
        run(["git", "commit", "-m", commit_message], check=True)

        print(f"Results committed to git: {file_path}")
        return True
    except Exception as e:
        print(f"Error committing to git: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(
        description="Retrieve Docker image sizes from GHCR"
    )
    parser.add_argument(
        "--output-dir",
        default=OUTPUT_DIR,
        help="Output directory for JSON files",
    )
    parser.add_argument(
        "-n", "--dry-run",
        action="store_true",
        help="Perform a dry run without committing to the repository",
    )
    parser.add_argument(
        "--github-token",
        default="",
        help="GitHub token for authentication (falls back to GITHUB_TOKEN env var)",
    )
    args = parser.parse_args()

    print(f"Fetching Docker image sizes for {ORG}/{IMAGE}")

    try:
        token_value = args.github_token
        token = get_auth_token(token_value)
    except Exception as e:
        print(f"Warning: Failed to get auth token: {e}")
        token = ""

    results = {
        "registry": REGISTRY_URL,
        "org": ORG,
        "image": IMAGE,
        "tags": TAGS,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "images": [],
    }

    print(f"Results")
    print(results)

    for tag in TAGS:
        print(f"Fetching size for tag: {tag}")
        size_info = get_image_size(token, tag)
        results["images"].append(size_info)
        if "error" not in size_info:
            print(
                f"  {tag}: "
                f"{size_info['compressed_size_gb']} GB (compressed), "
                f"{size_info['uncompressed_size_gb']} GB (uncompressed) "
                f"with {size_info['num_layers']} layers"
            )
        else:
            print(f"  {tag}: Error - {size_info['error']}")

    # Check if there's new data
    if not has_new_data(results):
        print("No new data detected. Skipping commit.")
        return

    # Save results with timestamp
    output_dir = pathlib.Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    output_filename = f"docker_image_sizes_{timestamp}.json"
    output_path = output_dir / output_filename

    with open(output_path, "w") as f:
        json.dump(results, f, indent=2)

    print(f"Results saved to {output_path}")

    # Commit to git
    if args.dry_run:
        print("Dry run: Skipping git commit")
    else:
        git_commit_results(str(output_path))


if __name__ == "__main__":
    main()
