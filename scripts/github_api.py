# GitHub Workflow API wrapper
import requests
from datetime import datetime


class GitHubWorkflowAPI:
    def __init__(self, github_token: str):
        self.github_token = github_token
        self.headers = {
            "Accept": "application/vnd.github+json",
            "Authorization": "Bearer " + github_token,
            "X-GitHub-Api-Version": "2022-11-28",
        }
        self.time_format = "%Y-%m-%dT%H:%M:%SZ"

    def get_workflow_duration_list(self, repo: str, workflow_id: str, accurate=False):
        payloads = {"per_page": 100, "status": "completed", "page": "1"}
        endpoint = (
            f"https://api.github.com/repos/{repo}/actions/workflows/{workflow_id}/runs"
        )

        first_page_response = requests.get(
            endpoint, headers=self.headers, params=payloads
        ).json()

        workflow_runs = first_page_response["workflow_runs"]

        print(f"Total count: {first_page_response['total_count']}")

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

        # Time format conversion (utility function)
        for run in workflow_runs:
            run["created_at"] = datetime.strptime(run["created_at"], self.time_format)
            run["updated_at"] = datetime.strptime(run["updated_at"], self.time_format)

        # Sorting by created_at (oldest to newest, utility function)
        workflow_runs = sorted(workflow_runs, key=lambda k: k["created_at"])

        # Extract duration from each workflow run
        if not accurate:
            # By created_at and updated_at
            for run in workflow_runs:
                run["duration"] = (
                    run["updated_at"] - run["created_at"]
                ).total_seconds()

            return workflow_runs

        # By calling jobs API for each workflow run
        for run in workflow_runs:
            jobs = requests.get(run["jobs_url"], headers=self.headers).json()["jobs"]

            run["duration"] = 0
            for job in jobs:
                if "completed_at" not in job or "started_at" not in job:
                    continue
                completed_at = datetime.strptime(job["completed_at"], self.time_format)
                started_at = datetime.strptime(job["started_at"], self.time_format)
                run["duration"] += (completed_at - started_at).total_seconds()

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
        response = requests.get(endpoint, headers=self.headers, params=payloads).json()

        packages = response

        while len(response) == payloads["per_page"]:
            payloads["page"] += 1
            response = requests.get(
                endpoint, headers=self.headers, params=payloads
            ).json()

            packages += response

        for package in packages:
            package["created_at"] = datetime.strptime(
                package["created_at"], self.time_format
            )
            package["updated_at"] = datetime.strptime(
                package["updated_at"], self.time_format
            )

        return packages
