import sys
import unittest
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import profile_backfill_queue as worker
from profile_backfill_queue import classify_result, usable_photo, rpc_status, result_exit_code


class SoccerWikiPhotoTests(unittest.TestCase):
    def test_photo_sw_writes_and_verifies_reachable_source(self):
        url = "https://cdn.soccerwiki.org/images/player/149111.png"
        card_id = "642fc812-0b0b-4902-8cd1-7e178da734de"

        def fake_request(path, params=None, method="GET", body=None):
            if path == "soccerwiki_player":
                return [{"photo_url": url}]
            if path == "cards" and method == "PATCH":
                self.assertEqual(params["or"], "(photo_url.is.null,photo_url.eq.)")
                self.assertEqual(body, {"photo_url": url})
                return [{"id": card_id, "photo_url": url}]
            if path == "cards":
                return [{"id": card_id, "photo_url": url}]
            raise AssertionError(f"unexpected request: {path} {method}")

        job = {"task_type": "photo_sw", "card_id": card_id}
        with patch("profile_backfill_queue.request", side_effect=fake_request), patch(
            "profile_backfill_queue.image_reachable", return_value=True
        ):
            output, exit_code = worker.run_collector(job)

        self.assertEqual(exit_code, 0)
        self.assertIn("Фото найдено: 1", output)
        self.assertIn("Источник: Soccer Wiki", output)

    def test_photo_sw_unreachable_source_is_retryable(self):
        url = "https://cdn.soccerwiki.org/images/player/149111.png"
        job = {"task_type": "photo_sw", "card_id": "642fc812-0b0b-4902-8cd1-7e178da734de"}
        with patch("profile_backfill_queue.request", return_value=[{"photo_url": url}]), patch(
            "profile_backfill_queue.image_reachable", return_value=False
        ):
            output, exit_code = worker.run_collector(job)

        self.assertNotEqual(exit_code, 0)
        self.assertEqual(classify_result(exit_code, output, False), "retry")

    def test_photo_sw_missing_source_is_no_data(self):
        job = {"task_type": "photo_sw", "card_id": "642fc812-0b0b-4902-8cd1-7e178da734de"}
        with patch("profile_backfill_queue.request", return_value=[]):
            output, exit_code = worker.run_collector(job)

        self.assertEqual(exit_code, 0)
        self.assertEqual(classify_result(exit_code, output, False), "no_data")


class QueueResultTests(unittest.TestCase):
    def test_only_readback_marks_success(self):
        self.assertEqual(classify_result(0, "written 1", True), "succeeded")
        self.assertEqual(
            classify_result(0, "Портретов найдено : 0\nЗаписано : 0", False),
            "no_data",
        )
        self.assertEqual(
            classify_result(0, "Портретов найдено : 1\nЗаписано : 1", False),
            "retry",
        )
        self.assertEqual(
            classify_result(0, "Строк статистики : 0\nБез матчей : 1", False),
            "no_data",
        )
        self.assertEqual(classify_result(0, "Строк статистики : 1", False), "retry")

    def test_transport_loss_is_retryable(self):
        self.assertEqual(classify_result(1, "HTTP 503", False), "retry")
        self.assertEqual(classify_result(0, "ПРОФИЛЕЙ ПОТЕРЯНО: 1", False), "retry")
        self.assertEqual(classify_result(0, "профилей потеряно: 1", False), "retry")

    def test_worker_retry_states_are_not_reported_as_success(self):
        self.assertEqual(result_exit_code([{"status": "succeeded"}]), 0)
        self.assertEqual(result_exit_code([{"status": "no_data"}]), 0)
        self.assertEqual(result_exit_code([{"status": "pending"}]), 1)
        self.assertEqual(result_exit_code([{"status": "failed"}]), 1)
        self.assertEqual(
            result_exit_code([{"status": "succeeded"}, {"status": "pending"}]), 1
        )

    def test_empty_source_is_not_success(self):
        self.assertNotEqual(classify_result(0, "portrait not found", False), "succeeded")

    def test_placeholder_portraits_are_not_verified(self):
        self.assertFalse(usable_photo("https://img.example/portrait/big/default.jpg"))
        self.assertFalse(usable_photo("https://img.example/dummy.png"))
        self.assertFalse(usable_photo("file:///tmp/player.jpg"))
        self.assertFalse(usable_photo("javascript:alert(1)"))
        self.assertFalse(usable_photo("https:///missing-host.jpg"))
        self.assertTrue(usable_photo("https://img.example/player/123.jpg"))

    def test_rpc_status_unwraps_postgrest_scalar_shapes(self):
        self.assertEqual(rpc_status("pending"), "pending")
        self.assertEqual(rpc_status(["pending"]), "pending")
        self.assertEqual(rpc_status({"finish_profile_backfill_job": ["failed"]}), "failed")


if __name__ == "__main__":
    unittest.main()
