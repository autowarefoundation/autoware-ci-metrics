# GitHub Workflow API wrapper
import math
from datetime import datetime, timezone
from typing import Optional

import requests


class GitHubWorkflowAPI:
    def __init__(self, github_token: str):
        self.github_token = github_token
        self.headers = {
            "Accept": "application/vnd.github+json",
            "Authorization": "Bearer " + github_token,
            "X-GitHub-Api-Version": "2022-11-28",
        }
        self.time_format = "%Y-%m-%dT%H:%M:%SZ"

    def get_workflow_duration_list(
        self,
        repo: str,
        workflow_id: str,
        accurate=False,
        created_after: Optional[datetime] = None,
        event: Optional[str] = None,
        branch: Optional[str] = None,
        only_success: bool = True,
    ):
        payloads = {"per_page": 100, "status": "completed", "page": "1"}
        if created_after is not None:
            # GitHub accepts "?created=>=YYYY-MM-DDTHH:MM:SSZ" as a server-side
            # filter — slashes the result set so we only page through new runs.
            payloads["created"] = ">=" + created_after.strftime(self.time_format)
        if event is not None:
            payloads["event"] = event
        if branch is not None:
            payloads["branch"] = branch
        endpoint = (
            f"https://api.github.com/repos/{repo}/actions/workflows/{workflow_id}/runs"
        )
        print(f"Fetching workflow runs from {endpoint} (created_after={created_after})")

        first_page_response = requests.get(
            endpoint, headers=self.headers, params=payloads
        ).json()
        workflow_runs = first_page_response["workflow_runs"]

        # Reuse first_page_response to get the total count of workflow runs
        total_count = first_page_response["total_count"]

        # Calculate the number of pages needed
        pages_needed = (total_count + payloads["per_page"] - 1) // payloads[
            "per_page"
        ]  # This calculates the ceiling of total_count/100

        # Fetch using the list of page numbers
        for page in range(2, pages_needed + 1):
            payloads["page"] = page
            page_response = requests.get(
                endpoint, headers=self.headers, params=payloads
            ).json()
            workflow_runs = page_response["workflow_runs"] + workflow_runs

        workflow_runs = [
            run
            for run in workflow_runs
            if (not only_success or run["conclusion"] == "success")
            and isinstance(run["created_at"], str)
            and isinstance(run["updated_at"], str)
        ]

        for run in workflow_runs:
            run["created_at"] = datetime.strptime(
                run["created_at"], self.time_format
            ).replace(tzinfo=timezone.utc)
            run["updated_at"] = datetime.strptime(
                run["updated_at"], self.time_format
            ).replace(tzinfo=timezone.utc)
            # run_started_at is the start of the *latest attempt*. For rerun
            # runs, created_at is the first attempt's queue time (possibly
            # days earlier), so using it inflates wall-clock. Matches what
            # GitHub's UI shows per-run.
            started_raw = run.get("run_started_at")
            if started_raw:
                run["run_started_at"] = datetime.strptime(
                    started_raw, self.time_format
                ).replace(tzinfo=timezone.utc)
            else:
                run["run_started_at"] = run["created_at"]
            head_commit = run.get("head_commit") or {}
            message = head_commit.get("message") or ""
            run["commit_title"] = message.splitlines()[0] if message else ""

        # Sorting by created_at (oldest to newest, utility function)
        workflow_runs = sorted(workflow_runs, key=lambda k: k["created_at"])

        # Extract duration from each workflow run
        if not accurate:
            # Wall-clock of the latest attempt (updated_at - run_started_at).
            # No per-job data.
            for run in workflow_runs:
                run["duration"] = (
                    run["updated_at"] - run["run_started_at"]
                ).total_seconds()
                run["jobs"] = {}

            return workflow_runs

        # By calling jobs API for each workflow run
        for index, run in enumerate(workflow_runs):
            json_response = requests.get(run["jobs_url"], headers=self.headers).json()
            if "jobs" not in json_response:
                print(f"Error in fetching jobs from {run['jobs_url']}: {json_response}")
                continue
            jobs = json_response["jobs"]

            run["jobs"] = {}
            run["duration"] = 0
            for job in jobs:
                try:
                    completed_at = datetime.strptime(
                        job["completed_at"], self.time_format
                    )
                    started_at = datetime.strptime(job["started_at"], self.time_format)
                except TypeError:
                    print(f"Error in parsing {job}")
                    continue
                run["jobs"][job["name"]] = (completed_at - started_at).total_seconds()
                run["duration"] += run["jobs"][job["name"]]
            print(
                f"{index + 1}/{len(workflow_runs)}: {run['created_at']} "
                f"{math.floor(run['duration'] / 60)}m "
                f"{math.floor(run['duration'] % 60)}s "
                f"{run['jobs']} {run['conclusion']}"
            )

        return workflow_runs

    def get_workflow_logs(self, repo: str, run_id: str):
        import zipfile
        from io import BytesIO

        # This endpoint redirects to a zip file
        endpoint = f"https://api.github.com/repos/{repo}/actions/runs/{run_id}/logs"
        response = requests.get(
            endpoint, headers=self.headers, allow_redirects=True
        ).content

        response = zipfile.ZipFile(BytesIO(response))

        # Extract all of log file into memory as string
        logs = {}

        for filename in response.namelist():
            logs[filename] = response.read(filename).decode("utf-8")

        return logs


class GithubPullRequestAPI:
    def __init__(self, github_token: str):
        self.github_token = github_token
        self.headers = {
            "Accept": "application/vnd.github+json",
            "Authorization": "Bearer " + github_token,
            "X-GitHub-Api-Version": "2022-11-28",
        }
        self.time_format = "%Y-%m-%dT%H:%M:%SZ"

    def get_all_pull_requests(self, repo: str):
        payloads = {"per_page": 100, "page": 1, "state": "all"}
        endpoint = f"https://api.github.com/repos/{repo}/pulls"
        response = requests.get(endpoint, headers=self.headers, params=payloads).json()

        pull_requests = response

        while len(response) == payloads["per_page"]:
            payloads["page"] += 1
            response = requests.get(
                endpoint, headers=self.headers, params=payloads
            ).json()

            pull_requests += response

        for pull_request in pull_requests:
            pull_request["created_at"] = datetime.strptime(
                pull_request["created_at"], self.time_format
            )
            if pull_request["closed_at"] is not None:
                pull_request["closed_at"] = datetime.strptime(
                    pull_request["closed_at"], self.time_format
                )

        return pull_requests


class GithubPackagesAPI:
    def __init__(self, github_token: str):
        self.github_token = github_token
        self.headers = {
            "Accept": "application/vnd.github+json",
            "Authorization": "Bearer " + github_token,
            "X-GitHub-Api-Version": "2022-11-28",
        }
        self.time_format = "%Y-%m-%dT%H:%M:%SZ"

    def get_all_containers(self, org: str, pkg: str):
        payloads = {"per_page": 100, "page": 1}
        endpoint = (
            f"https://api.github.com/orgs/{org}/packages/container/{pkg}/versions"
        )
        print(f"Fetching packages from {endpoint}")
        response = requests.get(endpoint, headers=self.headers, params=payloads).json()
        packages = response

        while len(response) == payloads["per_page"]:
            payloads["page"] += 1
            response = requests.get(
                endpoint, headers=self.headers, params=payloads
            ).json()

            packages += response

        for package in packages:
            try:
                package["created_at"] = datetime.strptime(
                    package["created_at"], self.time_format
                )
                package["updated_at"] = datetime.strptime(
                    package["updated_at"], self.time_format
                )
            except TypeError:
                print(f"Error in parsing {package}")
                continue

        return packages
