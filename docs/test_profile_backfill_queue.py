import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from profile_backfill_queue import classify_result, usable_photo, rpc_status


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
