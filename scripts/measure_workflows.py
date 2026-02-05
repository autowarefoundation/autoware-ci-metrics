import argparse
import json
import pathlib
from datetime import datetime, timedelta, timezone

import github_api
from colcon_log_analyzer import ColconLogAnalyzer

# Constant
REPO = "autowarefoundation/autoware"
HEALTH_CHECK_WORKFLOW_ID = "health-check.yaml"
DOCKER_BUILD_AND_PUSH_WORKFLOW_ID = "docker-build-and-push.yaml"
DOCKER_ORGS = "autowarefoundation"
DOCKER_IMAGE = "autoware"
CACHE_DIR = "./cache/"
DATA_DIR = "./data/"


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
        item for item in docker_build_and_push if 60 * 3 < item["duration"] < 3600 * 10
    ]
    return health_check, docker_build_and_push


def get_docker_image_analysis_from_data(date_threshold, data_dir=DATA_DIR):
    """Load docker image data from the data directory."""
    data_path = pathlib.Path(data_dir)
    if not data_path.exists():
        print(f"Data directory {data_path} does not exist")
        return {}

    docker_images = {
        "core-devel": [],
        "universe-devel": [],
        "universe-devel-cuda": [],
    }

    # Find all JSON files in the data directory
    json_files = sorted(data_path.glob("docker_image_sizes_*.json"))

    for json_file in json_files:
        try:
            with open(json_file) as f:
                data = json.load(f)

            # Parse the timestamp
            timestamp = datetime.fromisoformat(data["timestamp"])
            if timestamp < date_threshold:
                continue

            # Process each image in the data
            for image_data in data.get("images", []):
                tag = image_data["tag"]

                docker_images[tag].append(
                    {
                        "size_compressed": image_data.get("compressed_size_bytes", 0),
                        "size_uncompressed": image_data.get(
                            "uncompressed_size_bytes", 0
                        ),
                        "date": datetime.fromisoformat(
                            image_data["fetched_at"]
                        ).strftime("%Y/%m/%d %H:%M:%S"),
                        "tag": tag,
                    }
                )
        except Exception as e:
            print(f"Error processing {json_file}: {e}")
            continue

    return docker_images


def export_to_json(
    health_check,
    docker_build_and_push,
    docker_images,
):
    def _export_health_check_to_json(workflow):
        json_data = []
        for run in workflow:
            jobs = {}
            for job in run["jobs"]:
                if "docker-build (main)" in job:
                    jobs["main-amd64"] = run["jobs"][job]
                elif "docker-build (nightly)" in job:
                    jobs["nightly-amd64"] = run["jobs"][job]
                elif "docker-build (main-arm64)" in job:
                    jobs["main-arm64"] = run["jobs"][job]
            if len(jobs) == 0:
                continue

            json_data.append(
                {
                    "run_id": run["id"],
                    "date": run["created_at"].strftime("%Y/%m/%d %H:%M:%S"),
                    "duration": run["duration"] / 3600,
                    "jobs": jobs,
                }
            )
        return json_data

    def _export_docker_build_and_push_to_json(workflow):
        json_data = []
        for run in workflow:
            jobs = {}
            for job in run["jobs"]:
                if "docker-build-and-push (amd64)" in job:
                    jobs["main-amd64"] = run["jobs"][job]
                elif "docker-build-and-push (arm64)" in job:
                    jobs["main-arm64"] = run["jobs"][job]
                elif "docker-build-and-push-cuda (amd64)" in job:
                    jobs["cuda-amd64"] = run["jobs"][job]
                elif "docker-build-and-push-cuda (arm64)" in job:
                    jobs["cuda-arm64"] = run["jobs"][job]
                elif "docker-build-and-push-tools (amd64)" in job:
                    jobs["tools-amd64"] = run["jobs"][job]
                elif "docker-build-and-push-tools (arm64)" in job:
                    jobs["tools-arm64"] = run["jobs"][job]
            if len(jobs) == 0:
                continue

            json_data.append(
                {
                    "run_id": run["id"],
                    "date": run["created_at"].strftime("%Y/%m/%d %H:%M:%S"),
                    "duration": run["duration"] / 3600,
                    "jobs": jobs,
                }
            )
        return json_data

    json_data = {
        "workflow_time": {
            "health-check": _export_health_check_to_json(health_check),
            "docker-build-and-push": _export_docker_build_and_push_to_json(
                docker_build_and_push
            ),
        },
        "docker_images": docker_images,
    }
    return json_data


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Fetch GitHub Action's run data and plot it."
    )
    parser.add_argument(
        "--github_token",
        required=True,
        help="GitHub Token to authenticate with GitHub API.",
    )
    parser.add_argument(
        "--data-dir",
        default=DATA_DIR,
        help="Directory containing data files.",
    )
    args = parser.parse_args()

    github_token = args.github_token

    date_threshold = datetime.now(timezone.utc) - timedelta(days=90)
    (
        health_check,
        docker_build_and_push,
    ) = get_workflow_runs(github_token, date_threshold)
    docker_images = get_docker_image_analysis_from_data(date_threshold, args.data_dir)
    json_data = export_to_json(
        health_check,
        docker_build_and_push,
        docker_images,
    )

    with open("github_action_data.json", "w") as jsonfile:
        json.dump(json_data, jsonfile, indent=4)
