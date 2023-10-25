import matplotlib.pyplot as plt
import csv
import argparse

import github_api
from colcon_log_analyzer import ColconLogAnalyzer

# Constant
REPO = "autowarefoundation/autoware"
WORKFLOW_ID = "build-main-self-hosted.yaml"
BUILD_LOG_ID = "build-main-self-hosted/9_Build.txt"

# Setup argparse to parse command-line arguments
parser = argparse.ArgumentParser(
    description="Fetch GitHub Action's run data and plot it."
)
parser.add_argument(
    "--github_token",
    required=True,
    help="GitHub Token to authenticate with GitHub API.",
)
args = parser.parse_args()

# Use the github_token passed as command-line argument
github_token = args.github_token

workflow_api = github_api.GitHubWorkflowAPI(github_token)

# TODO: Enable accurate options when it runs on GitHub Actions (because of rate limit)
workflow_runs = workflow_api.get_workflow_duration_list(
    REPO, WORKFLOW_ID, accurate=False
)

####################
# Build time analysis
####################


# Exclude outliers (TODO: Fix outliers appears in inaccurate mode)
workflow_runs = [item for item in workflow_runs if item["duration"] < 3600 * 100]

# Extract duration from each workflow run (for matplotlib)
data = [[run["created_at"], run["duration"] / 3600] for run in workflow_runs]

# Save the data to a CSV file
with open("github_action_data.csv", "w", newline="") as csvfile:
    writer = csv.writer(csvfile)
    writer.writerow(["Date", "Duration (hours)"])  # Write header
    for row in data:
        writer.writerow(row)

# If you want to plot, use the following:
dates = [row[0] for row in data]
durations = [row[1] for row in data]

# Plotting the graph
plt.figure(figsize=(10, 6))
plt.plot(dates, durations, marker="o")
plt.xlabel("Date")
plt.ylabel("Duration (hours)")
plt.title("GitHub Action Execution Time")
plt.grid(True)
plt.xticks(rotation=45)
plt.tight_layout()

# Save the graph as an image
output_graph_filename = "output_graph.png"
plt.savefig(output_graph_filename)

# If you still want to show the graph (not necessary for the GitHub Actions workflow)
# plt.show()

####################
# Log analysis
####################

# Sample some of the logs
# criteria(TODO): first build of each month
# assumption: workflow_runs is sorted by created_at
log_sample_run = {}

for run in workflow_runs:
    year_month = run["created_at"].strftime("%Y-%m")
    if year_month not in log_sample_run:
        log_sample_run[year_month] = run

log_sample_run = list(log_sample_run.values())

package_duration_logs = {}

# Fetch logs
# Log may be removed, so handling 404 error is necessary
for run in log_sample_run:
    try:
        logs = workflow_api.get_workflow_logs(REPO, run["id"])
    except:
        print(f"Log for run_id={run['id']} cannot be fetched.")
        continue

    build_log_text = logs[BUILD_LOG_ID]
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
# Output JSON for Pages
####################

json_data = {"workflow_time": [], "package_time": {}}

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

for logs in package_duration_logs.values():
    for package, duration in logs["duration"].items():
        if package not in json_data["package_time"]:
            json_data["package_time"][package] = [duration]
        else:
            json_data["package_time"][package].append(duration)

# Save the data to a JSON file
import json

with open("github_action_data.json", "w") as jsonfile:
    json.dump(json_data, jsonfile, indent=4)
