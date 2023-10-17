import json
import requests
from datetime import datetime
time_format = "%Y-%m-%dT%H:%M:%SZ"

github_token = "TODO"

headers = {"Accept": "application/vnd.github+json",
           "Authorization": "Bearer " + github_token, "X-GitHub-Api-Version": "2022-11-28"}
payloads = {"per_page": 100, "status": "success", "page": "1"}

workflow_id = "build-main-self-hosted.yaml"

workflow_runs = []

page_list = [7,6,5,4,3,2,1]
for page in page_list:
    payloads["page"] = page
    workflow_runs_raw = requests.get("https://api.github.com/repos/autowarefoundation/autoware/actions/workflows/" + workflow_id + "/runs",
                                 headers=headers, params=payloads).json()
    workflow_runs = workflow_runs_raw["workflow_runs"] + workflow_runs

for run in workflow_runs:
    jobs = requests.get(run["jobs_url"], headers=headers).json()["jobs"]
    job_number = 1
    if len(jobs) == 1: job_number = 0
    completed_at = datetime.strptime(jobs[job_number]["completed_at"], time_format)
    started_at = datetime.strptime(jobs[job_number]["started_at"], time_format)
    duration = completed_at - started_at
    duration_str = str(duration.seconds // 3600) + ":" + str((duration.seconds % 3600) // 60) + ":" + str(duration.seconds % 60)
    date_str = str(started_at.year) + "/" + str(started_at.month) + "/" + str(started_at.day)
    print(date_str + "," + duration_str)
