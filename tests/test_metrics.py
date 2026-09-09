import json
import pathlib
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from unittest.mock import Mock, patch

import requests

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "scripts"))

import check_image_digests
import docker_image_size
import measure_workflows


class HealthCheckTests(unittest.TestCase):
    def test_historical_and_current_matrix_names(self):
        cases = {
            "docker-build (main)": "main-humble-amd64",
            "health-check / docker-build (nightly)": "nightly-humble-amd64",
            "health-check (main-arm64) / docker-build": "main-humble-arm64",
            "health-check (main) / docker-build": "main-humble-amd64",
            "health-check (nightly) / docker-build": "nightly-humble-amd64",
            "label-check / make-sure-label-is-present": None,
        }
        for key in (
            "main-humble-amd64",
            "main-humble-arm64",
            "nightly-humble-amd64",
            "main-jazzy-amd64",
            "main-jazzy-arm64",
        ):
            cases[f"health-check ({key}) / docker-build"] = key
        for job, expected in cases.items():
            with self.subTest(job=job):
                self.assertEqual(
                    measure_workflows.health_check_job_key(job), expected
                )

    def test_export_keeps_distros_and_historical_runs(self):
        runs = [
            {
                "id": 1,
                "created_at": datetime(2026, 9, 8, tzinfo=timezone.utc),
                "duration": 7200,
                "jobs": {
                    "health-check (main) / docker-build": 1200,
                    "health-check (main-jazzy-amd64) / docker-build": 2400,
                    "health-check (main-jazzy-arm64) / docker-build": 3600,
                },
            }
        ]
        result = measure_workflows.export_to_json(runs, [], {}, {})
        self.assertEqual(
            result["workflow_time"]["health-check"][0]["jobs"],
            {
                "main-humble-amd64": 1200,
                "main-jazzy-amd64": 2400,
                "main-jazzy-arm64": 3600,
            },
        )

    def test_parallel_jobs_do_not_hit_aggregate_duration_cap(self):
        def run(run_id, durations):
            return {
                "id": run_id,
                "created_at": datetime(2026, 9, 8, tzinfo=timezone.utc),
                "duration": sum(durations),
                "jobs": {str(i): d for i, d in enumerate(durations)},
                "conclusion": "success",
            }

        runs = [run(1, [3 * 3600] * 5), run(2, [11 * 3600]), run(3, [30])]
        with tempfile.TemporaryDirectory() as directory, patch.object(
            measure_workflows.github_api.GitHubWorkflowAPI,
            "get_workflow_duration_list",
            return_value=runs,
        ):
            result = measure_workflows.collect_workflow_runs(
                "health-check", pathlib.Path(directory), "test-token"
            )
            self.assertEqual([r["id"] for r in result], [1])
            # Repeated collection does not duplicate the recovered run.
            result = measure_workflows.collect_workflow_runs(
                "health-check", pathlib.Path(directory), "test-token"
            )
            self.assertEqual([r["id"] for r in result], [1])


class RegistryTests(unittest.TestCase):
    def response(self, manifest, digest="sha256:direct"):
        return Mock(
            json=Mock(return_value=manifest),
            headers={"Docker-Content-Digest": digest},
        )

    def test_oci_and_docker_indexes_select_linux_amd64(self):
        for media_type in docker_image_size.INDEX_MEDIA_TYPES:
            with self.subTest(media_type=media_type):
                index = self.response(
                    {
                        "mediaType": media_type,
                        "manifests": [
                            {
                                "digest": "sha256:attestation",
                                "platform": {
                                    "os": "unknown",
                                    "architecture": "unknown",
                                },
                            },
                            {
                                "digest": "sha256:arm64",
                                "platform": {
                                    "os": "linux",
                                    "architecture": "arm64",
                                },
                            },
                            {
                                "digest": "sha256:windows",
                                "platform": {
                                    "os": "windows",
                                    "architecture": "amd64",
                                },
                            },
                            {
                                "digest": "sha256:amd64",
                                "platform": {
                                    "os": "linux",
                                    "architecture": "amd64",
                                },
                            },
                        ],
                    }
                )
                manifest = self.response(
                    {"layers": [{"size": 120}, {"size": 80}]}
                )
                with patch.object(
                    requests, "get", side_effect=[index, manifest]
                ) as get:
                    result = docker_image_size.get_compressed_size(
                        "https://ghcr.io/v2/example/image", "jazzy", "token"
                    )
                self.assertEqual(result, (200, 2, "sha256:amd64"))
                self.assertTrue(get.call_args.args[0].endswith("/sha256:amd64"))
                for call in get.call_args_list:
                    self.assertIn(media_type, call.kwargs["headers"]["Accept"])

    def test_direct_manifest_keeps_digest_for_change_detection(self):
        with patch.object(
            requests,
            "get",
            return_value=self.response(
                {
                    "mediaType": "application/vnd.oci.image.manifest.v1+json",
                    "layers": [{"size": 200}],
                }
            ),
        ):
            self.assertEqual(
                docker_image_size.get_compressed_size(
                    "https://ghcr.io/v2/example/image", "jazzy", "token"
                ),
                (200, 1, "sha256:direct"),
            )

    def test_missing_platform_or_layers_is_an_error(self):
        for manifest in (
            {
                "mediaType": "application/vnd.oci.image.index.v1+json",
                "manifests": [
                    {
                        "digest": "sha256:arm64",
                        "platform": {"architecture": "arm64", "os": "linux"},
                    },
                ],
            },
            {"layers": []},
            {"layers": [{"size": 0}]},
        ):
            with self.subTest(manifest=manifest), patch.object(
                requests, "get", return_value=self.response(manifest)
            ), self.assertRaises(ValueError):
                docker_image_size.get_compressed_size(
                    "https://registry/image", "tag", "token"
                )

    def test_failed_registry_lookup_does_not_pull_or_measure_zero(self):
        with patch.object(
            docker_image_size,
            "get_compressed_size",
            side_effect=requests.HTTPError,
        ), patch.object(docker_image_size, "get_uncompressed_size") as pull:
            result = docker_image_size.get_image_size("token", "tag")
        self.assertIn("error", result)
        self.assertNotIn("compressed_size_bytes", result)
        pull.assert_not_called()

    def test_failed_pull_does_not_create_complete_measurement(self):
        with patch.object(
            docker_image_size,
            "get_compressed_size",
            return_value=(200, 1, "sha256:amd64"),
        ), patch.object(
            docker_image_size, "get_uncompressed_size", return_value=0
        ):
            self.assertIn(
                "error", docker_image_size.get_image_size("token", "tag")
            )

    def test_cli_failure_does_not_append_measurement(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(
            sys,
            "argv",
            [
                "measure",
                "--output-dir",
                directory,
                "--tags",
                "core-dependencies-jazzy",
            ],
        ), patch.object(
            docker_image_size, "get_auth_token", return_value="token"
        ), patch.object(
            docker_image_size,
            "get_compressed_size",
            side_effect=requests.HTTPError("registry unavailable"),
        ), patch.object(
            docker_image_size, "get_uncompressed_size"
        ) as pull:
            self.assertEqual(docker_image_size.main(), 1)
            self.assertEqual(list(pathlib.Path(directory).glob("*.jsonl")), [])
            pull.assert_not_called()


class DigestCheckTests(unittest.TestCase):
    def test_latest_incomplete_measurement_is_retried(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "docker_image_sizes-2026.jsonl"
            valid = {
                "tag": "tag",
                "fetched_at": "2026-09-08T00:00:00+00:00",
                "digest": "sha256:amd64",
                "compressed_size_bytes": 200,
                "uncompressed_size_bytes": 400,
            }
            path.write_text(json.dumps(valid) + "\n")
            self.assertEqual(
                check_image_digests.latest_recorded_digest(path.parent, "tag"),
                "sha256:amd64",
            )
            for size_field in (
                "compressed_size_bytes",
                "uncompressed_size_bytes",
            ):
                invalid = dict(valid, fetched_at="2026-09-09T00:00:00+00:00")
                invalid[size_field] = 0
                path.write_text(
                    json.dumps(valid) + "\n" + json.dumps(invalid) + "\n"
                )
                self.assertEqual(
                    check_image_digests.latest_recorded_digest(
                        path.parent, "tag"
                    ),
                    "",
                )

    def test_empty_history_measures_and_lookup_failure_fails_check(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(
            sys, "argv", ["check", "--data-dir", directory]
        ), patch.object(
            check_image_digests, "CANONICAL_TAGS", ["tag"]
        ), patch.object(
            check_image_digests, "get_auth_token", return_value="token"
        ), patch.dict(
            "os.environ", {"GITHUB_OUTPUT": directory + "/output"}
        ):
            output = pathlib.Path(directory) / "output"
            with patch.object(
                check_image_digests,
                "get_compressed_size",
                return_value=(200, 1, "sha256:amd64"),
            ):
                self.assertEqual(check_image_digests.main(), 0)
                self.assertIn("should-measure=true", output.read_text())
            output.unlink()
            with patch.object(
                check_image_digests,
                "get_compressed_size",
                side_effect=requests.HTTPError,
            ):
                self.assertEqual(check_image_digests.main(), 1)
                self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
