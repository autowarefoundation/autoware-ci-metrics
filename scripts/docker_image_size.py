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
    url = f"{REGISTRY_URL}/token?service=ghcr.io&scope=repository:{ORG}/{IMAGE}:pull"
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


def get_compressed_size(image: str, tag: str, token: str) -> tuple[int, int, str]:
    """Get the compressed size of a Docker image from registry manifest.

    Returns a tuple of (compressed_size_bytes, num_layers, digest).
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

        response = requests.get(manifest_list_url, headers=headers_list, timeout=30)
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

        print(
            f"Compressed size for {tag}: {total_compressed} bytes ({len(layers)} layers)"
        )
        return total_compressed, len(layers), amd64_digest or ""

    except Exception as e:
        print(f"Warning: Failed to get compressed size for {tag}: {e}")
        return 0, 0, ""


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
                stdout=PIPE,
                stderr=PIPE,
                text=True,
            )

            if pull_result.returncode != 0:
                print(f"Warning: Failed to pull image with {cmd}: {pull_result.stderr}")
                continue

            # Get image size using inspect
            inspect_result = run(
                [cmd, "inspect", image_ref],
                stdout=PIPE,
                stderr=PIPE,
                timeout=30,
                text=True,
            )

            remove_result = run(
                [cmd, "system", "prune", "--all", "--force"],
                stdout=PIPE,
                stderr=PIPE,
                text=True,
            )

            if inspect_result.returncode != 0:
                print(
                    f"Warning: Failed to inspect image with {cmd}: {inspect_result.stderr}"
                )
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


def get_image_size(token: str, tag: str) -> dict:
    """Get the compressed and uncompressed size of a Docker image."""
    try:
        # Get compressed size from registry manifest
        image = f"{REGISTRY_URL}/v2/{ORG}/{IMAGE}"
        compressed_size, num_layers, digest = get_compressed_size(image, tag, token)

        # Get uncompressed size by pulling the image
        image = f"{REGISTRY}/{ORG}/{IMAGE}"
        uncompressed_size = get_uncompressed_size(image, tag)

        return {
            "tag": tag,
            "compressed_size_bytes": compressed_size,
            "compressed_size_gb": round(compressed_size / (1024**3), 2),
            "uncompressed_size_bytes": uncompressed_size,
            "uncompressed_size_gb": round(uncompressed_size / (1024**3), 2),
            "num_layers": num_layers,
            "digest": digest,
            "fetched_at": (datetime.now(timezone.utc).isoformat()),
        }
    except Exception as e:
        print(f"Error fetching size for {tag}: {e}")
        return {
            "tag": tag,
            "error": str(e),
            "digest": "",
            "fetched_at": (datetime.now(timezone.utc).isoformat()),
        }


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

    # Save results with timestamp
    output_dir = pathlib.Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    output_filename = f"docker_image_sizes_{timestamp}.json"
    output_path = output_dir / output_filename

    with open(output_path, "w") as f:
        json.dump(results, f, indent=2)

    print(f"Results saved to {output_path}")


if __name__ == "__main__":
    main()
