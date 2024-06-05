# `colcon build` output analysis


import re
from datetime import datetime
from typing import Dict, List, Tuple


class ColconLogAnalyzer:
    def __init__(self, log_text: str):
        self.log_text = log_text

    def get_build_duration_list(self) -> List[Tuple[str, datetime, float]]:
        """Get a list of build durations from log files.

        Returns:
            List[Tuple[datetime, float]]: A list of build durations.
        """

        # example: 2023-10-24T12:34:34.2585864Z Finished <<< component_interface_specs [32.3s]
        start_regex = re.compile(r"Starting >>> ([\w_]+)")
        end_regex = re.compile(r"Finished <<< ([\w_]+)")
        start_time_dict: Dict[str, datetime] = {}
        build_duration_list = []
        for line in self.log_text.split("\n"):
            if match := start_regex.search(line):
                start_time_dict[match.group(1)] = datetime.strptime(
                    line[:26], "%Y-%m-%dT%H:%M:%S.%f"
                )
            elif match := end_regex.search(line):
                start_time = start_time_dict[match.group(1)]
                end_time = datetime.strptime(line[:26], "%Y-%m-%dT%H:%M:%S.%f")
                build_duration_list.append(
                    (
                        match.group(1),
                        start_time,
                        (end_time - start_time).total_seconds(),
                    )
                )
        return build_duration_list
