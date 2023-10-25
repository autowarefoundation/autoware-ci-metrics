import matplotlib.pyplot as plt
import csv
import argparse

import github_api

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

time_format = "%Y-%m-%dT%H:%M:%SZ"

# Use the github_token passed as command-line argument
github_token = args.github_token

workflow_api = github_api.GitHubWorkflowAPI(github_token)

workflow_id = "build-main-self-hosted.yaml"

# TODO: Enable accurate options when it runs on GitHub Actions (because of rate limit)
workflow_runs = workflow_api.get_workflow_duration_list(workflow_id, accurate=False)

# Extract duration from each workflow run
data = [[run["created_at"], run["duration"] / 3600] for run in workflow_runs]

# Exclude outliers
data = [row for row in data if row[1] < 100]

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
