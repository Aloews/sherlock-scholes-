import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from profile_backfill_queue import classify_result, usable_photo


class QueueResultTests(unittest.TestCase):
    def test_only_readback_marks_success(self):
        self.assertEqual(classify_result(0,"written 1",True),"succeeded")
        self.assertEqual(classify_result(0,"written 0",False),"no_data")
    def test_transport_loss_is_retryable(self):
        self.assertEqual(classify_result(1,"HTTP 503",False),"retry")
        self.assertEqual(classify_result(0,"ПРОФИЛЕЙ ПОТЕРЯНО: 1",False),"retry")
    def test_empty_source_is_not_success(self):
        self.assertNotEqual(classify_result(0,"portrait not found",False),"succeeded")
    def test_placeholder_portraits_are_not_verified(self):
        self.assertFalse(usable_photo("https://img.example/portrait/big/default.jpg"))
        self.assertFalse(usable_photo("https://img.example/dummy.png"))
        self.assertTrue(usable_photo("https://img.example/player/123.jpg"))


if __name__=="__main__": unittest.main()
