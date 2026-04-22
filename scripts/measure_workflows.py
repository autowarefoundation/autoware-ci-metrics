import argparse
import functools
import json
import pathlib
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Optional

print = functools.partial(print, flush=True)

import github_api
from image_tags import TAGS as CANONICAL_TAGS

REPO = "autowarefoundation/autoware"

# Backfill window when no JSONL exists yet (first run after migration).
BACKFILL_DAYS = 90
# Overlap re-fetched on each incremental run, in case late-completing runs
# slipped in just under the previous cursor.
CURSOR_OVERLAP = timedelta(days=1)

# Per-workflow collection config. `accurate=True` triggers a jobs-API call
# per run (needed to get per-job durations); `accurate=False` is wall-clock
# only (created_at..updated_at) and skips the jobs API.
WORKFLOWS = {
    "health-check": {
        "id": "health-check.yaml",
        "accurate": True,
        "event": None,
        "branch": None,
        # 3 min .. 10 h — drops cancelled-early and hung runs.
        "min_seconds": 60 * 3,
        "max_seconds": 3600 * 10,
    },
    "docker-build-and-push": {
        "id": "docker-build-and-push.yaml",
        "accurate": False,
        "event": "push",
        "branch": "main",
        # No min_seconds — the changed-files fast-path (<20 min successes)
        # is real workflow activity worth surfacing. max_seconds stays as
        # a sanity cap against hung runs.
        "min_seconds": 0,
        "max_seconds": 3600 * 10,
        "only_success": False,
    },
}

# Status-aware per-repo CI tracking for the swimlane chart. Unlike WORKFLOWS
# above, this keeps non-success runs (failure/cancelled/skipped) so the
# dashboard can color them, and it carries commit metadata + run URL so
# each dot links back to the actual run.
MULTI_REPO_WORKFLOWS = [
    {"repo": "autowarefoundation/autoware_core",     "workflow_id": "build-and-test.yaml"},
    {"repo": "autowarefoundation/autoware_universe", "workflow_id": "build-and-test.yaml"},
    {"repo": "autowarefoundation/autoware_tools",    "workflow_id": "build-and-test.yaml"},
]


def workflow_basename(workflow_id: str) -> str:
    if workflow_id.endswith(".yaml"):
        return workflow_id[:-5]
    if workflow_id.endswith(".yml"):
        return workflow_id[:-4]
    return workflow_id


def workflow_runs_dir(data_dir: pathlib.Path) -> pathlib.Path:
    return data_dir / "workflow_runs"


def load_existing_workflow_runs(
    data_dir: pathlib.Path, workflow_id: str
) -> tuple[set, Optional[datetime], list[dict]]:
    """Read all yearly JSONL files for a workflow.

    Returns (existing_run_ids, max_created_at, all_entries_with_datetime).
    """
    base = workflow_basename(workflow_id)
    files = sorted(workflow_runs_dir(data_dir).glob(f"{base}-*.jsonl"))
    run_ids: set = set()
    max_dt: Optional[datetime] = None
    entries: list[dict] = []
    for path in files:
        with path.open() as f:
            for line in f:
                entry = json.loads(line)
                entry["created_at"] = datetime.fromisoformat(entry["created_at"])
                entries.append(entry)
                run_ids.add(entry["run_id"])
                if max_dt is None or entry["created_at"] > max_dt:
                    max_dt = entry["created_at"]
    return run_ids, max_dt, entries


def append_workflow_runs(
    data_dir: pathlib.Path, workflow_id: str, runs: list[dict]
) -> int:
    """Append new GitHub-shaped run dicts to the appropriate yearly JSONL."""
    if not runs:
        return 0
    base = workflow_basename(workflow_id)
    out_dir = workflow_runs_dir(data_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    by_year: dict[int, list[dict]] = defaultdict(list)
    for run in runs:
        by_year[run["created_at"].year].append(run)

    total = 0
    for year, year_runs in sorted(by_year.items()):
        year_runs.sort(key=lambda r: r["created_at"])
        path = out_dir / f"{base}-{year}.jsonl"
        with path.open("a") as f:
            for run in year_runs:
                f.write(
                    json.dumps(
                        {
                            "run_id": run["id"],
                            "created_at": run["created_at"].isoformat(),
                            "duration": run["duration"],
                            "jobs": run["jobs"],
                            "conclusion": run["conclusion"],
                            "html_url": run.get("html_url", ""),
                        }
                    )
                    + "\n"
                )
                total += 1
        print(f"    appended {len(year_runs)} -> {path}")
    return total


def collect_workflow_runs(
    workflow_key: str, data_dir: pathlib.Path, github_token: str
) -> list[dict]:
    """Incrementally fetch + persist runs for a workflow; return all known runs."""
    spec = WORKFLOWS[workflow_key]
    workflow_id = spec["id"]
    print(f"workflow: {workflow_id}")
    existing_ids, max_dt, existing_entries = load_existing_workflow_runs(
        data_dir, workflow_id
    )

    if max_dt is None:
        cursor = datetime.now(timezone.utc) - timedelta(days=BACKFILL_DAYS)
        print(f"  no existing data; backfilling from {cursor.date()}")
    else:
        cursor = max_dt - CURSOR_OVERLAP
        print(
            f"  existing through {max_dt.isoformat()}; fetching since {cursor.isoformat()}"
        )

    api = github_api.GitHubWorkflowAPI(github_token)
    fetched = api.get_workflow_duration_list(
        REPO,
        workflow_id,
        accurate=spec["accurate"],
        created_after=cursor,
        event=spec["event"],
        branch=spec["branch"],
        only_success=spec.get("only_success", True),
    )
    print(f"  fetched {len(fetched)} runs from API")

    # max_seconds is a universal sanity cap. min_seconds only filters
    # *success* runs (drops the changed-files no-op fast path) — failures
    # of any duration are kept so the dashboard can surface them.
    def in_band(r):
        if r["duration"] >= spec["max_seconds"]:
            return False
        if r["conclusion"] == "success" and r["duration"] <= spec["min_seconds"]:
            return False
        return True

    in_band_runs = [r for r in fetched if in_band(r)]
    new_runs = [r for r in in_band_runs if r["id"] not in existing_ids]
    print(f"  in-band: {len(in_band_runs)}; new (deduped): {len(new_runs)}")

    append_workflow_runs(data_dir, workflow_id, new_runs)

    # Existing entries already have datetime created_at + run_id; expose `id`
    # so export_to_json can treat them uniformly with freshly-fetched runs.
    for entry in existing_entries:
        entry["id"] = entry["run_id"]
    combined = existing_entries + [
        {
            "id": r["id"],
            "created_at": r["created_at"],
            "duration": r["duration"],
            "jobs": r["jobs"],
            "conclusion": r["conclusion"],
            "html_url": r.get("html_url", ""),
        }
        for r in new_runs
    ]
    combined.sort(key=lambda r: r["created_at"])
    return combined


def repo_short_name(repo: str) -> str:
    return repo.rsplit("/", 1)[-1]


def multi_repo_runs_dir(data_dir: pathlib.Path, repo: str) -> pathlib.Path:
    return workflow_runs_dir(data_dir) / repo_short_name(repo)


def load_existing_multi_repo_runs(
    data_dir: pathlib.Path, repo: str, workflow_id: str
) -> tuple[set, Optional[datetime], list[dict]]:
    base = workflow_basename(workflow_id)
    files = sorted(multi_repo_runs_dir(data_dir, repo).glob(f"{base}-*.jsonl"))
    run_ids: set = set()
    max_dt: Optional[datetime] = None
    entries: list[dict] = []
    for path in files:
        with path.open() as f:
            for line in f:
                entry = json.loads(line)
                entry["created_at"] = datetime.fromisoformat(entry["created_at"])
                entries.append(entry)
                run_ids.add(entry["run_id"])
                if max_dt is None or entry["created_at"] > max_dt:
                    max_dt = entry["created_at"]
    return run_ids, max_dt, entries


def append_multi_repo_runs(
    data_dir: pathlib.Path, repo: str, workflow_id: str, runs: list[dict]
) -> int:
    if not runs:
        return 0
    base = workflow_basename(workflow_id)
    out_dir = multi_repo_runs_dir(data_dir, repo)
    out_dir.mkdir(parents=True, exist_ok=True)

    by_year: dict[int, list[dict]] = defaultdict(list)
    for run in runs:
        by_year[run["created_at"].year].append(run)

    total = 0
    for year, year_runs in sorted(by_year.items()):
        year_runs.sort(key=lambda r: r["created_at"])
        path = out_dir / f"{base}-{year}.jsonl"
        with path.open("a") as f:
            for run in year_runs:
                f.write(
                    json.dumps(
                        {
                            "run_id": run["id"],
                            "created_at": run["created_at"].isoformat(),
                            "duration": run["duration"],
                            "conclusion": run["conclusion"],
                            "html_url": run.get("html_url", ""),
                            "head_sha": run.get("head_sha", ""),
                            "commit_title": run.get("commit_title", ""),
                        }
                    )
                    + "\n"
                )
                total += 1
        print(f"    appended {len(year_runs)} -> {path}")
    return total


def collect_multi_repo_runs(
    repo: str, workflow_id: str, data_dir: pathlib.Path, github_token: str
) -> list[dict]:
    """Scrape a single (repo, workflow) pair for the swimlane chart.

    Retains all terminal conclusions (not only success), writes a richer
    schema with html_url + head_sha + commit_title for hover/click UX.
    """
    print(f"{repo} :: {workflow_id}")
    existing_ids, max_dt, existing_entries = load_existing_multi_repo_runs(
        data_dir, repo, workflow_id
    )

    if max_dt is None:
        cursor = datetime.now(timezone.utc) - timedelta(days=BACKFILL_DAYS)
        print(f"  no existing data; backfilling from {cursor.date()}")
    else:
        cursor = max_dt - CURSOR_OVERLAP
        print(
            f"  existing through {max_dt.isoformat()}; fetching since {cursor.isoformat()}"
        )

    api = github_api.GitHubWorkflowAPI(github_token)
    fetched = api.get_workflow_duration_list(
        repo,
        workflow_id,
        accurate=False,
        created_after=cursor,
        event="push",
        branch="main",
        only_success=False,
    )
    print(f"  fetched {len(fetched)} runs from API")

    new_runs = [r for r in fetched if r["id"] not in existing_ids]
    print(f"  new (deduped): {len(new_runs)}")

    append_multi_repo_runs(data_dir, repo, workflow_id, new_runs)

    for entry in existing_entries:
        entry["id"] = entry["run_id"]
    combined = existing_entries + [
        {
            "id": r["id"],
            "created_at": r["created_at"],
            "duration": r["duration"],
            "conclusion": r["conclusion"],
            "html_url": r.get("html_url", ""),
            "head_sha": r.get("head_sha", ""),
            "commit_title": r.get("commit_title", ""),
        }
        for r in new_runs
    ]
    combined.sort(key=lambda r: r["created_at"])
    return combined


def load_docker_image_history(data_dir: pathlib.Path) -> dict:
    """Read all yearly docker JSONL files into the dashboard-shaped dict."""
    docker_images: dict[str, list[dict]] = {tag: [] for tag in CANONICAL_TAGS}
    files = sorted(data_dir.glob("docker_image_sizes-*.jsonl"))
    for path in files:
        with path.open() as f:
            for line in f:
                entry = json.loads(line)
                tag = entry.get("tag", "")
                if tag not in docker_images:
                    continue
                docker_images[tag].append(
                    {
                        "size_compressed": entry.get("compressed_size_bytes", 0),
                        "size_uncompressed": entry.get(
                            "uncompressed_size_bytes", 0
                        ),
                        "date": datetime.fromisoformat(entry["fetched_at"]).strftime(
                            "%Y/%m/%d %H:%M:%S"
                        ),
                        "tag": tag,
                        "digest": entry.get("digest", ""),
                    }
                )
    for tag, entries in docker_images.items():
        print(f"  {tag}: {len(entries)} data points")
    return docker_images


def export_to_json(health_check, docker_build_and_push, docker_images, repo_ci_runs):
    def _export_health_check(workflow):
        out = []
        for run in workflow:
            jobs = {}
            for job in run["jobs"]:
                if "docker-build (main)" in job:
                    jobs["main-amd64"] = run["jobs"][job]
                elif "docker-build (nightly)" in job:
                    jobs["nightly-amd64"] = run["jobs"][job]
                elif "docker-build (main-arm64)" in job:
                    jobs["main-arm64"] = run["jobs"][job]
            if not jobs:
                continue
            out.append(
                {
                    "run_id": run["id"],
                    "date": run["created_at"].strftime("%Y/%m/%d %H:%M:%S"),
                    "duration": run["duration"] / 3600,
                    "jobs": jobs,
                }
            )
        return out

    def _export_docker_build_and_push(workflow):
        # Single wall-clock duration per run — push-to-main only. Non-success
        # runs are included so the dashboard can plot failures/cancellations
        # alongside the success line, coloured by conclusion.
        return [
            {
                "run_id": run["id"],
                "date": run["created_at"].strftime("%Y/%m/%d %H:%M:%S"),
                "duration": run["duration"] / 3600,
                "jobs": {"total": run["duration"]},
                "conclusion": run.get("conclusion", "success"),
                "html_url": run.get("html_url", ""),
            }
            for run in workflow
        ]

    def _export_repo_ci_runs(runs_by_repo):
        out: dict[str, list[dict]] = {}
        for repo_key, runs in runs_by_repo.items():
            out[repo_key] = [
                {
                    "run_id": r["id"],
                    "date": r["created_at"].strftime("%Y/%m/%d %H:%M:%S"),
                    "duration": r["duration"],
                    "conclusion": r["conclusion"],
                    "html_url": r.get("html_url", ""),
                    "head_sha": r.get("head_sha", ""),
                    "commit_title": r.get("commit_title", ""),
                }
                for r in runs
            ]
        return out

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "workflow_time": {
            "health-check": _export_health_check(health_check),
            "docker-build-and-push": _export_docker_build_and_push(
                docker_build_and_push
            ),
        },
        "docker_images": docker_images,
        "repo_ci_runs": _export_repo_ci_runs(repo_ci_runs),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Incrementally fetch GitHub Actions metrics + render dashboard JSON."
    )
    parser.add_argument(
        "--github_token",
        required=True,
        help="GitHub Token to authenticate with GitHub API.",
    )
    parser.add_argument(
        "--data-dir",
        required=True,
        type=pathlib.Path,
        help="Path to the data-storage checkout.",
    )
    args = parser.parse_args()

    health_check = collect_workflow_runs(
        "health-check", args.data_dir, args.github_token
    )
    docker_build_and_push = collect_workflow_runs(
        "docker-build-and-push", args.data_dir, args.github_token
    )

    repo_ci_runs: dict[str, list[dict]] = {}
    for spec in MULTI_REPO_WORKFLOWS:
        repo_ci_runs[repo_short_name(spec["repo"])] = collect_multi_repo_runs(
            spec["repo"], spec["workflow_id"], args.data_dir, args.github_token
        )

    print(f"Loading docker image history from {args.data_dir}")
    docker_images = load_docker_image_history(args.data_dir)

    json_data = export_to_json(
        health_check, docker_build_and_push, docker_images, repo_ci_runs
    )
    with open("github_action_data.json", "w") as f:
        json.dump(json_data, f, indent=4)
    print("Wrote github_action_data.json")
