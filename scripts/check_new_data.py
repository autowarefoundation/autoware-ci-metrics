#!/usr/bin/env python3
"""Check and commit new data files using git."""

import argparse
import sys
from datetime import datetime, timezone
from subprocess import PIPE, run


def has_new_data_files(data_dir: str) -> bool:
    """Check if there are new or modified files in the data directory using git.

    Returns True if there are unstaged or staged changes in the data directory.
    """
    try:
        # Check for unstaged changes in the data directory
        result = run(
            ["git", "diff", "--quiet", "--", data_dir],
            stdout=PIPE,
            stderr=PIPE,
            timeout=10,
        )
        has_unstaged = result.returncode != 0

        # Check for staged changes in the data directory
        result = run(
            ["git", "diff", "--cached", "--quiet", "--", data_dir],
            stdout=PIPE,
            stderr=PIPE,
            timeout=10,
        )
        has_staged = result.returncode != 0

        # Check for untracked files in the data directory
        result = run(
            ["git", "ls-files", "--others", "--exclude-standard", data_dir],
            stdout=PIPE,
            stderr=PIPE,
            timeout=10,
            text=True,
        )
        has_untracked = bool(result.stdout.strip())

        return has_unstaged or has_staged or has_untracked

    except Exception as e:
        print(f"Error checking git status: {e}", file=sys.stderr)
        return False


def git_commit_data(data_dir: str, commit_message: str = "") -> bool:
    """Commit new data files to git.

    Returns True if commit was successful, False otherwise.
    """
    try:
        run(["git", "config", "user.email", "github-actions@github.com"], check=True)
        run(["git", "config", "user.name", "github-actions"], check=True)
        run(["git", "add", data_dir], check=True)

        if not commit_message:
            timestamp = datetime.now(timezone.utc).isoformat()
            commit_message = f"Update data files - {timestamp}"

        run(["git", "commit", "-m", commit_message], check=True)

        print(f"Data files committed to git: {data_dir}")
        return True
    except Exception as e:
        print(f"Error committing to git: {e}", file=sys.stderr)
        return False


def main():
    parser = argparse.ArgumentParser(
        description="Check and commit new data files using git"
    )
    parser.add_argument(
        "data_dir",
        help="Data directory to check for changes",
    )
    parser.add_argument(
        "--commit",
        action="store_true",
        help="Commit changes if new data files are found",
    )
    parser.add_argument(
        "--message",
        default="",
        help="Custom commit message (default: auto-generated with timestamp)",
    )
    args = parser.parse_args()

    if has_new_data_files(args.data_dir):
        print(f"New data files detected in {args.data_dir}")

        if args.commit:
            if git_commit_data(args.data_dir, args.message):
                sys.exit(0)
            else:
                sys.exit(1)
        else:
            sys.exit(0)
    else:
        print(f"No new data files in {args.data_dir}")
        sys.exit(1)


if __name__ == "__main__":
    main()
