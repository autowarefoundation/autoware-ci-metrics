import argparse
import json
from datetime import datetime

import github_api
from colcon_log_analyzer import ColconLogAnalyzer
from dxf import DXF

# Constant
REPO = "autowarefoundation/autoware"
HEALTH_CHECK_WORKFLOW_ID = ["health-check.yaml", "build-main.yaml"]
HEALTH_CHECK_SELF_HOSTED_WORKFLOW_ID = [
    "health-check-arm64.yaml",
    "health-check-self-hosted.yaml",
    "build-main-self-hosted.yaml",
]
DOCKER_BUILD_AND_PUSH_WORKFLOW_ID = [
    "docker-build-and-push.yaml",
    "docker-build-and-push-main.yaml",
]
DOCKER_BUILD_AND_PUSH_SELF_HOSTED_WORKFLOW_ID = [
    "docker-build-and-push-arm64.yaml",
    "docker-build-and-push-self-hosted.yaml",
    "docker-build-and-push-main-self-hosted.yaml",
]
BUILD_LOG_IDS = [
    "_Build.txt",
    "_Build 'autoware-universe'.txt",
    "_Build 'Autoware'.txt",
]
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
        REPO, HEALTH_CHECK_WORKFLOW_ID[1], True, date_threshold
    ) + workflow_api.get_workflow_duration_list(
        REPO, HEALTH_CHECK_WORKFLOW_ID[0], True, date_threshold
    )
    health_check_self_hosted = workflow_api.get_workflow_duration_list(
        REPO, HEALTH_CHECK_SELF_HOSTED_WORKFLOW_ID[2], True, date_threshold
    ) + workflow_api.get_workflow_duration_list(
        REPO, HEALTH_CHECK_SELF_HOSTED_WORKFLOW_ID[1], True, date_threshold
    ) + workflow_api.get_workflow_duration_list(
        REPO, HEALTH_CHECK_SELF_HOSTED_WORKFLOW_ID[0], True, date_threshold
    )
    docker_build_and_push = workflow_api.get_workflow_duration_list(
        REPO, DOCKER_BUILD_AND_PUSH_WORKFLOW_ID[1], True, date_threshold
    ) + workflow_api.get_workflow_duration_list(
        REPO, DOCKER_BUILD_AND_PUSH_WORKFLOW_ID[0], True, date_threshold
    )
    docker_build_and_push_self_hosted = workflow_api.get_workflow_duration_list(
        REPO, DOCKER_BUILD_AND_PUSH_SELF_HOSTED_WORKFLOW_ID[2], True, date_threshold
    ) + workflow_api.get_workflow_duration_list(
        REPO, DOCKER_BUILD_AND_PUSH_SELF_HOSTED_WORKFLOW_ID[1], True, date_threshold
    ) + workflow_api.get_workflow_duration_list(
        REPO, DOCKER_BUILD_AND_PUSH_SELF_HOSTED_WORKFLOW_ID[0], True, date_threshold
    )

    # Exclude outliers (TODO: Fix outliers appears in inaccurate mode)
    health_check = [
        item for item in health_check if 60 * 3 < item["duration"] < 3600 * 10
    ]
    health_check_self_hosted = [
        item
        for item in health_check_self_hosted
        if 60 * 3 < item["duration"] < 3600 * 10
    ]
    docker_build_and_push = [
        item
        for item in docker_build_and_push
        if 60 * 3 < item["duration"] < 3600 * 10
    ]
    docker_build_and_push_self_hosted = [
        item
        for item in docker_build_and_push_self_hosted
        if 60 * 3 < item["duration"] < 3600 * 10
    ]
    return health_check, health_check_self_hosted, docker_build_and_push, docker_build_and_push_self_hosted


def get_package_duration_logs(github_token):
    workflow_api = github_api.GitHubWorkflowAPI(github_token)
    package_duration_logs = {}

    # Fetch logs
    # Log may be removed, so handling 404 error is necessary
    for run in health_check:
        # older than 90 days
        if (datetime.now() - run["created_at"]).days > 90:
            continue

        try:
            logs = try_cache(
                f"{REPO}-{run['id']}",
                lambda: workflow_api.get_workflow_logs(REPO, run["id"]),
            )
        except Exception as e:
            print(f"Log for run_id={run['id']} cannot be fetched. {e}")
            continue

        build_log_text = ""
        for log in logs.keys():
            if any([log_id in log for log_id in BUILD_LOG_IDS]):
                print(log)
                build_log_text = logs[log]
                break
        if build_log_text == "":
            print(f"Log for run_id={run['id']} not found.")
            continue

        analyzer = ColconLogAnalyzer(build_log_text)
        package_duration_list = analyzer.get_build_duration_list()

        # Sort by duration
        package_duration_list = sorted(
            package_duration_list, key=lambda k: -k[2]
        )

        # Into KV
        package_duration_dict = {}

        for package in package_duration_list:
            package_duration_dict[package[0]] = package[2]

        package_duration_logs[run["id"]] = {
            "run_id": run["id"],
            "date": run["created_at"],
            "duration": package_duration_dict,
        }
    return package_duration_logs


def get_docker_image_analysis(github_token, github_actor):
    package_api = github_api.GithubPackagesAPI(github_token)
    packages = package_api.get_all_containers(DOCKER_ORGS, DOCKER_IMAGE)

    def auth(dxf, response):
        dxf.authenticate(github_actor, github_token, response=response)

    docker_images = {
        "base": [],
        "core": [],
        "core-devel": [],
        "universe-sensing-perception": [],
        "universe-sensing-perception-devel": [],
        "universe-localization-mapping": [],
        "universe-localization-mapping-devel": [],
        "universe-planning-control": [],
        "universe-planning-control-devel": [],
        "universe": [],
        "universe-devel": [],
        "base-cuda": [],
        "core-cuda": [],
        "core-devel-cuda": [],
        "universe-sensing-perception-cuda": [],
        "universe-sensing-perception-devel-cuda": [],
        "universe-localization-mapping-cuda": [],
        "universe-localization-mapping-devel-cuda": [],
        "universe-planning-control-cuda": [],
        "universe-planning-control-devel-cuda": [],
        "universe-cuda": [],
        "universe-devel-cuda": [],
    }

    dxf = DXF("ghcr.io", f"{DOCKER_ORGS}/{DOCKER_IMAGE}", auth)
    for package in packages:
        tag_count = len(package["metadata"]["container"]["tags"])
        if tag_count == 0:
            continue
        tag = package["metadata"]["container"]["tags"][0]
        if not tag.endswith("amd64"):
            continue
        docker_image = ""
        if "autoware-" in tag:
            for key in (
                "autoware-core",
                "autoware-universe",
            ):
                if key in tag:
                    docker_image = (
                        ("core-devel" if "core" in tag else "universe-devel")
                        + ("-cuda" if "cuda" in tag else "")
                    )
                    break
        else:
            matched = False
            for key in ("universe-sensing-perception",
                        "universe-localization-mapping",
                        "universe-planning-control"):
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
                        + ("-devel" if "devel" in tag else "")
                        + ("-cuda" if "cuda" in tag else "")
                    )
                elif "base" in tag:
                    docker_image = (
                        "base"
                        + ("-cuda" if "cuda" in tag else "")
                    )
                elif "devel" in tag:
                    docker_image = (
                        "universe-devel"
                        + ("-cuda" if "cuda" in tag else "")
                    )
                elif "runtime" in tag:
                    docker_image = (
                        "universe"
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
        metadata = json.loads(
            (manifest["linux/amd64"] if type(manifest) is dict else manifest)
        )

        total_size = sum([layer["size"] for layer in metadata["layers"]])
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
    health_check_self_hosted,
    docker_build_and_push,
    docker_build_and_push_self_hosted,
    package_duration_logs,
    docker_images,
):
    def _export_to_json(workflow):
        json_data = []
        for run in workflow:
            # check run["jobs"] has "(cuda)" and "(no-cuda)" jobs
            cuda_job = None
            no_cuda_job = None
            for job in run["jobs"]:
                if "(cuda)" in job:
                    cuda_job = job
                elif "(no-cuda)" in job:
                    no_cuda_job = job
            if cuda_job is None or no_cuda_job is None:
                continue

            json_data.append(
                {
                    "run_id": run["id"],
                    "date": run["created_at"].strftime("%Y/%m/%d %H:%M:%S"),
                    "duration": run["duration"] / 3600,
                    "jobs": {
                        "cuda": run["jobs"][cuda_job],
                        "no-cuda": run["jobs"][no_cuda_job],
                    },
                    "details": package_duration_logs[run["id"]]["duration"]
                    if run["id"] in package_duration_logs
                    else None,
                }
            )
        return json_data

    json_data = {
        "workflow_time": {
            "health-check": _export_to_json(health_check),
            "health-check-self-hosted": _export_to_json(
                health_check_self_hosted
            ),
            "docker-build-and-push": _export_to_json(docker_build_and_push),
            "docker-build-and-push-self-hosted": _export_to_json(docker_build_and_push_self_hosted),
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
        health_check_self_hosted,
        docker_build_and_push,
        docker_build_and_push_self_hosted,
    ) = get_workflow_runs(github_token, datetime(2024, 1, 1))
    package_duration_logs = get_package_duration_logs(github_token)
    docker_images = get_docker_image_analysis(github_token, github_actor)
    json_data = export_to_json(
        health_check,
        health_check_self_hosted,
        docker_build_and_push,
        docker_build_and_push_self_hosted,
        package_duration_logs,
        docker_images,
    )

    with open("github_action_data.json", "w") as jsonfile:
        json.dump(json_data, jsonfile, indent=4)
