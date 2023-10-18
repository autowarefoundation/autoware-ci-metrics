import json
import requests
from datetime import datetime
import matplotlib.pyplot as plt
import csv
import argparse

# Setup argparse to parse command-line arguments
parser = argparse.ArgumentParser(description="Fetch GitHub Action's run data and plot it.")
parser.add_argument('--github_token', required=True, help="GitHub Token to authenticate with GitHub API.")
args = parser.parse_args()

time_format = "%Y-%m-%dT%H:%M:%SZ"

# Use the github_token passed as command-line argument
github_token = args.github_token

headers = {"Accept": "application/vnd.github+json",
           "Authorization": "Bearer " + github_token, "X-GitHub-Api-Version": "2022-11-28"}
payloads = {"per_page": 100, "status": "success", "page": "1"}

workflow_id = "build-main-self-hosted.yaml"

workflow_runs = []

# Get total count of workflow runs
workflow_count_response = requests.get(
    "https://api.github.com/repos/autowarefoundation/autoware/actions/workflows/" + workflow_id + "/runs",
    headers=headers, params={"per_page": 1}).json()  # Just retrieve one result to get the total count
total_count = workflow_count_response["total_count"]

# Calculate the number of pages needed
pages_needed = (total_count + 99) // 100  # This calculates the ceiling of total_count/100

# Generate the list of page numbers
page_list = list(range(1, pages_needed + 1))


for page in page_list:
    payloads["page"] = page
    workflow_runs_raw = requests.get("https://api.github.com/repos/autowarefoundation/autoware/actions/workflows/" + workflow_id + "/runs",
                                 headers=headers, params=payloads).json()
    workflow_runs = workflow_runs_raw["workflow_runs"] + workflow_runs

data = []

for run in workflow_runs:
    jobs = requests.get(run["jobs_url"], headers=headers).json()["jobs"]
    job_number = 1
    if len(jobs) == 1: job_number = 0
    completed_at = datetime.strptime(jobs[job_number]["completed_at"], time_format)
    started_at = datetime.strptime(jobs[job_number]["started_at"], time_format)
    duration = completed_at - started_at
    duration_sec = duration.total_seconds()
    data.append([started_at, duration_sec / 3600])  # Append date and duration (in hours) to the data list
    print(data[-1])

# Save the data to a CSV file
with open('github_action_data.csv', 'w', newline='') as csvfile:
    writer = csv.writer(csvfile)
    writer.writerow(['Date', 'Duration (hours)'])  # Write header
    for row in data:
        writer.writerow(row)

# If you want to plot, use the following:
dates = [row[0] for row in data]
durations = [row[1] for row in data]

# Plotting the graph
plt.figure(figsize=(10, 6))
plt.plot(dates, durations, marker='o')
plt.xlabel('Date')
plt.ylabel('Duration (hours)')
plt.title('GitHub Action Execution Time')
plt.grid(True)
plt.xticks(rotation=45)
plt.tight_layout()

# Save the graph as an image
output_graph_filename = "output_graph.png"
plt.savefig(output_graph_filename)

# If you still want to show the graph (not necessary for the GitHub Actions workflow)
# plt.show()
