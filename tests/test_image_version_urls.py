import json
import pathlib
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock, patch

import requests

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "scripts"))

from image_version_urls import CACHE_FILE, add_image_version_urls


class ImageVersionUrlTests(unittest.TestCase):
    def response(self, versions):
        return Mock(json=Mock(return_value=versions))

    def test_resolves_historical_digests_across_pages_and_reuses_cache(self):
        old_digest = "sha256:" + "a" * 64
        new_digest = "sha256:" + "b" * 64
        old_url = "https://github.com/orgs/autowarefoundation/packages/container/autoware/101"
        new_url = "https://github.com/orgs/autowarefoundation/packages/container/autoware/202"
        images = {
            "core-dependencies-jazzy": [
                {"digest": old_digest},
                {"digest": new_digest},
            ]
        }
        first_page = [{"name": "unrelated", "html_url": ""}] * 99 + [
            {"name": new_digest, "html_url": new_url},
        ]
        second_page = [{"name": old_digest, "html_url": old_url}]
        with tempfile.TemporaryDirectory() as directory, patch(
            "image_version_urls.requests.get",
            side_effect=[self.response(first_page), self.response(second_page)],
        ) as get:
            root = pathlib.Path(directory)
            add_image_version_urls(images, root, "token")
            self.assertEqual(
                [
                    entry["html_url"]
                    for entry in images["core-dependencies-jazzy"]
                ],
                [old_url, new_url],
            )
            self.assertEqual(
                [call.kwargs["params"]["page"] for call in get.call_args_list],
                [1, 2],
            )
            add_image_version_urls(images, root, "token")
            self.assertEqual(get.call_count, 2)

    def test_missing_versions_are_retried_after_a_day(self):
        digest = "sha256:" + "a" * 64
        images = {"tag": [{"digest": digest}, {"digest": ""}]}
        with tempfile.TemporaryDirectory() as directory, patch(
            "image_version_urls.requests.get", return_value=self.response([])
        ) as get:
            root = pathlib.Path(directory)
            add_image_version_urls(images, root, "token")
            self.assertEqual(
                [entry["html_url"] for entry in images["tag"]], ["", ""]
            )
            add_image_version_urls(images, root, "token")
            self.assertEqual(get.call_count, 1)
            cache_path = root / CACHE_FILE
            cache = json.loads(cache_path.read_text())
            cache[digest]["checked_at"] = (
                datetime.now(timezone.utc) - timedelta(days=2)
            ).isoformat()
            cache_path.write_text(json.dumps(cache))
            get.return_value = self.response(
                [
                    {
                        "name": digest,
                        "html_url": "https://github.com/orgs/autowarefoundation/packages/container/autoware/101",
                    }
                ]
            )
            add_image_version_urls(images, root, "token")
            self.assertTrue(images["tag"][0]["html_url"].endswith("/101"))
            self.assertEqual(get.call_count, 2)

    def test_failed_api_request_does_not_cache_versions_as_missing(self):
        images = {"tag": [{"digest": "sha256:" + "a" * 64}]}
        with tempfile.TemporaryDirectory() as directory, patch(
            "image_version_urls.requests.get", side_effect=requests.HTTPError
        ):
            root = pathlib.Path(directory)
            add_image_version_urls(images, root, "token")
            self.assertFalse((root / CACHE_FILE).exists())
            self.assertEqual(images["tag"][0]["html_url"], "")

    def test_cached_links_survive_an_api_failure_for_another_digest(self):
        known = "sha256:" + "a" * 64
        unknown = "sha256:" + "b" * 64
        url = "https://github.com/orgs/autowarefoundation/packages/container/autoware/101"
        images = {"tag": [{"digest": known}, {"digest": unknown}]}
        with tempfile.TemporaryDirectory() as directory, patch(
            "image_version_urls.requests.get", side_effect=requests.HTTPError
        ):
            root = pathlib.Path(directory)
            (root / CACHE_FILE).write_text(
                json.dumps(
                    {
                        known: {
                            "html_url": url,
                            "checked_at": datetime.now(
                                timezone.utc
                            ).isoformat(),
                        }
                    }
                )
            )
            add_image_version_urls(images, root, "token")
            self.assertEqual(images["tag"][0]["html_url"], url)
            self.assertNotIn(
                unknown, json.loads((root / CACHE_FILE).read_text())
            )
