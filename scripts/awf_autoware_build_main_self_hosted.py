from datetime import datetime
import re
import argparse

import github_api
from colcon_log_analyzer import ColconLogAnalyzer
from dxf import DXF

import numpy as np
import json

# Constant
REPO = "autowarefoundation/autoware"
BUILD_WORKFLOW_ID = "build-main.yaml"
BUILD_LOG_IDS = [
    "build-main/9_Build.txt",
    "build-main (cuda)/5_Build 'autoware-universe'.txt",
    "build-main (cuda)/7_Build 'autoware-universe'.txt",
]
DOCKER_ORGS = "autowarefoundation"
DOCKER_IMAGE = "autoware-universe"
CACHE_DIR = "./cache/"


# Utility function
def try_cache(key: str, f):
    import pathlib
    import json

    key = key.replace("/", "_")
    cache_path = pathlib.Path(CACHE_DIR) / key

    if cache_path.exists():
        with open(cache_path, "r") as cache_file:
            return json.load(cache_file)
    else:
        result = f()
        if result is None:
            raise Exception("Result is None")
        with open(cache_path, "w") as cache_file:
            json.dump(result, cache_file, indent=4)
        return result


# Setup argparse to parse command-line arguments
parser = argparse.ArgumentParser(
    description="Fetch GitHub Action's run data and plot it."
)
parser.add_argument(
    "--github_token",
    required=True,
    help="GitHub Token to authenticate with GitHub API.",
)
parser.add_argument(
    "--github_actor",
    required=True,
    help="GitHub username to authenticate with GitHub API (Packages).",
)
args = parser.parse_args()

# Use the github_token passed as command-line argument
github_token = args.github_token
github_actor = args.github_actor

workflow_api = github_api.GitHubWorkflowAPI(github_token)

# TODO: Enable accurate options when it runs on GitHub Actions (because of rate limit)
workflow_runs = workflow_api.get_workflow_duration_list(
    REPO, BUILD_WORKFLOW_ID, accurate=True
)

####################
# Build time analysis
####################


# Exclude outliers (TODO: Fix outliers appears in inaccurate mode)
workflow_runs = [item for item in workflow_runs if 60 < item["duration"] < 3600 * 100]

####################
# Log analysis
####################

package_duration_logs = {}

# Fetch logs
# Log may be removed, so handling 404 error is necessary
for run in workflow_runs:
    # older than 90 days
    if (datetime.now() - run["created_at"]).days > 90:
        continue

    # skip
    if run["conclusion"] != "success":
        continue

    try:
        logs = try_cache(
            f"{REPO}-{run['id']}",
            lambda: workflow_api.get_workflow_logs(REPO, run["id"]),
        )
    except Exception as e:
        print(f"Log for run_id={run['id']} cannot be fetched. {e}")
        continue

    print(f"log keys: {logs.keys()}")
    build_log_text = ""
    for log_id in BUILD_LOG_IDS:
        if log_id in logs.keys():
            build_log_text = logs[log_id]
            break
    if build_log_text == "":
        print(f"Log for run_id={run['id']} not found.")
        continue

    analyzer = ColconLogAnalyzer(build_log_text)
    package_duration_list = analyzer.get_build_duration_list()

    # Sort by duration
    package_duration_list = sorted(package_duration_list, key=lambda k: -k[2])

    # Into KV
    package_duration_dict = {}

    for package in package_duration_list:
        package_duration_dict[package[0]] = package[2]

    package_duration_logs[run["id"]] = {
        "run_id": run["id"],
        "date": run["created_at"],
        "duration": package_duration_dict,
    }

####################
# Docker image analysis
####################

package_api = github_api.GithubPackagesAPI(github_token)
packages = package_api.get_all_containers(DOCKER_ORGS, DOCKER_IMAGE)


def auth(dxf, response):
    dxf.authenticate(github_actor, github_token, response=response)


docker_images = []

dxf = DXF("ghcr.io", f"{DOCKER_ORGS}/{DOCKER_IMAGE}", auth)
for package in packages:
    tag_count = len(package["metadata"]["container"]["tags"])
    if tag_count == 0:
        continue
    tag = package["metadata"]["container"]["tags"][0]
    if not tag.endswith("amd64") or "cuda" in tag or "prebuilt" not in tag:
        continue

    print(tag)
    manifest = try_cache(f"docker_{tag}", lambda: dxf.get_manifest(tag))
    if manifest is None:
        print(f"Failed to fetch manifest for {tag}")
        continue
    metadata = json.loads(
        (manifest["linux/amd64"] if type(manifest) is dict else manifest)
    )
    # print(metadata)

    total_size = sum([layer["size"] for layer in metadata["layers"]])
    docker_images.append(
        {
            "size": total_size,
            "date": package["updated_at"].strftime("%Y/%m/%d %H:%M:%S"),
            "tag": tag,
        }
    )


####################
# Output JSON for Pages
####################

json_data = {
    "workflow_time": [],
    "spell_checks": spell_checks,
    "pulls": {
        "total": len(all_pr),
        "closed": len(closed_pr),
        "closed_per_month": five_close_per_month,
    },
    "docker_images": docker_images,
}

for run in workflow_runs:
    json_data["workflow_time"].append(
        {
            "run_id": run["id"],
            "date": run["created_at"].strftime("%Y/%m/%d %H:%M:%S"),
            "duration": run["duration"] / 3600,
            "details": package_duration_logs[run["id"]]["duration"]
            if run["id"] in package_duration_logs
            else None,
        }
    )

# Save the data to a JSON file


with open("github_action_data.json", "w") as jsonfile:
    json.dump(json_data, jsonfile, indent=4)
