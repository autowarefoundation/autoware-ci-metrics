import argparse
import json
from datetime import datetime

import github_api
from colcon_log_analyzer import ColconLogAnalyzer
from dxf import DXF

# Constant
REPO = "autowarefoundation/autoware"
HEALTH_CHECK_WORKFLOW_ID = "health-check.yaml"
DOCKER_BUILD_AND_PUSH_WORKFLOW_ID = "docker-build-and-push.yaml"
DOCKER_ORGS = "autowarefoundation"
DOCKER_IMAGE = "autoware"
CACHE_DIR = "./cache/"


# Utility function
def try_cache(key: str, f):
    import json
    import pathlib

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


def get_workflow_runs(github_token, date_threshold):
    workflow_api = github_api.GitHubWorkflowAPI(github_token)

    # TODO: Enable accurate options when it runs on GitHub Actions (because of rate limit)
    health_check = workflow_api.get_workflow_duration_list(
        REPO, HEALTH_CHECK_WORKFLOW_ID, True, date_threshold
    )
    docker_build_and_push = workflow_api.get_workflow_duration_list(
        REPO, DOCKER_BUILD_AND_PUSH_WORKFLOW_ID, True, date_threshold
    )

    # Exclude outliers (TODO: Fix outliers appears in inaccurate mode)
    health_check = [
        item for item in health_check if 60 * 3 < item["duration"] < 3600 * 10
    ]
    docker_build_and_push = [
        item
        for item in docker_build_and_push
        if 60 * 3 < item["duration"] < 3600 * 10
    ]
    return health_check, docker_build_and_push


def get_docker_image_analysis(github_token, github_actor):
    package_api = github_api.GithubPackagesAPI(github_token)
    packages = package_api.get_all_containers(DOCKER_ORGS, DOCKER_IMAGE)

    def auth(dxf, response):
        dxf.authenticate(github_actor, github_token, response=response)

    docker_images = {
        "core-common-devel": [],
        "core-devel": [],
        "core": [],
        "universe-common-devel": [],
        "universe-sensing-perception-devel": [],
        "universe-sensing-perception-devel-cuda": [],
        "universe-localization-mapping-devel": [],
        "universe-planning-control-devel": [],
        "universe-vehicle-system-devel": [],
        "universe-sensing-perception": [],
        "universe-sensing-perception-cuda": [],
        "universe-localization-mapping": [],
        "universe-planning-control": [],
        "universe-vehicle-system": [],
        "universe-devel": [],
        "universe-devel-cuda": [],
        "universe": [],
        "universe-cuda": [],
    }

    dxf = DXF("ghcr.io", f"{DOCKER_ORGS}/{DOCKER_IMAGE}", auth)
    for package in packages:
        tag_count = len(package["metadata"]["container"]["tags"])
        if tag_count == 0:
            continue
        tag = package["metadata"]["container"]["tags"][0]
        docker_image = ""
        matched = False
        for key in ("universe-sensing-perception",
                    "universe-localization-mapping",
                    "universe-planning-control",
                    "universe-vehicle-system"):
            if key in tag:
                docker_image = (
                    key
                    + ("-devel" if "devel" in tag else "")
                    + ("-cuda" if "cuda" in tag else "")
                )
                matched = True
                break
        if not matched:
            if "universe" in tag:
                docker_image = (
                    "universe"
                    + ("-common" if "common" in tag else "")
                    + ("-devel" if "devel" in tag else "")
                    + ("-cuda" if "cuda" in tag else "")
                )
            elif "core" in tag:
                docker_image = (
                    "core"
                    + ("-common" if "common" in tag else "")
                    + ("-devel" if "devel" in tag else "")
                    + ("-cuda" if "cuda" in tag else "")
                )
        print(docker_image)
        if docker_image == "":
            continue

        print(f"Fetching manifest for {tag}")
        manifest = try_cache(f"docker_{tag}", lambda: dxf.get_manifest(tag))
        if manifest is None:
            print(f"Failed to fetch manifest for {tag}")
            continue
        if type(manifest) is dict:
            manifest = manifest["linux/amd64"]
        metadata = json.loads(manifest)

        total_size = sum([layer["size"] for layer in metadata["layers"]])
        if docker_image in docker_images:
            docker_images[docker_image].append(
                {
                    "size": total_size,
                    "date": package["updated_at"].strftime("%Y/%m/%d %H:%M:%S"),
                    "tag": tag,
                }
            )
    return docker_images


def export_to_json(
    health_check,
    docker_build_and_push,
    docker_images,
):
    def _export_health_check_to_json(workflow):
        json_data = []
        for run in workflow:
            main_amd64_job = None
            nightly_amd64_job = None
            main_arm64_job = None
            for job in run["jobs"]:
                if "docker-build (main)" in job:
                    main_amd64_job = job
                elif "docker-build (nightly)" in job:
                    nightly_amd64_job = job
                elif "docker-build (main-arm64)" in job:
                    main_arm64_job = job
            if main_amd64_job is None and nightly_amd64_job is None and main_arm64_job is None:
                continue

            json_data.append(
                {
                    "run_id": run["id"],
                    "date": run["created_at"].strftime("%Y/%m/%d %H:%M:%S"),
                    "duration": run["duration"] / 3600,
                    "jobs": {
                        "main-amd64": run["jobs"][main_amd64_job],
                        "nightly-amd64": run["jobs"][nightly_amd64_job],
                        "main-arm64": run["jobs"][main_arm64_job],
                    },
                }
            )
        return json_data

    def _export_docker_build_and_push_to_json(workflow):
        json_data = []
        for run in workflow:
            main_amd64_job = None
            main_arm64_job = None
            cuda_amd64_job = None
            cuda_arm64_job = None
            tools_amd64_job = None
            tools_arm64_job = None
            for job in run["jobs"]:
                if "docker-build-and-push (amd64)" in job:
                    main_amd64_job = job
                elif "docker-build-and-push (arm64)" in job:
                    main_arm64_job = job
                elif "docker-build-and-push-cuda (amd64)" in job:
                    cuda_amd64_job = job
                elif "docker-build-and-push-cuda (arm64)" in job:
                    cuda_arm64_job = job
                elif "docker-build-and-push-tools (amd64)" in job:
                    tools_amd64_job = job
                elif "docker-build-and-push-tools (arm64)" in job:
                    tools_arm64_job = job
            if main_amd64_job is None and main_arm64_job is None and cuda_amd64_job is None and cuda_arm64_job is None and tools_amd64_job is None and tools_arm64_job is None:
                continue

            json_data.append(
                {
                    "run_id": run["id"],
                    "date": run["created_at"].strftime("%Y/%m/%d %H:%M:%S"),
                    "duration": run["duration"] / 3600,
                    "jobs": {
                        "main-amd64": run["jobs"][main_amd64_job],
                        "main-arm64": run["jobs"][main_arm64_job],
                        "cuda-amd64": run["jobs"][cuda_amd64_job],
                        "cuda-arm64": run["jobs"][cuda_arm64_job],
                        "tools-amd64": run["jobs"][tools_amd64_job],
                        "tools-arm64": run["jobs"][tools_arm64_job],
                    },
                }
            )
        return json_data

    json_data = {
        "workflow_time": {
            "health-check": _export_health_check_to_json(health_check),
            "docker-build-and-push": _export_docker_build_and_push_to_json(docker_build_and_push),
        },
        "docker_images": docker_images,
    }
    return json_data


if __name__ == "__main__":
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

    (
        health_check,
        docker_build_and_push,
    ) = get_workflow_runs(github_token, datetime(2024, 1, 1))
    docker_images = get_docker_image_analysis(github_token, github_actor)
    json_data = export_to_json(
        health_check,
        docker_build_and_push,
        docker_images,
    )

    with open("github_action_data.json", "w") as jsonfile:
        json.dump(json_data, jsonfile, indent=4)
