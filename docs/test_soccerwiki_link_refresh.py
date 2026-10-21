import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import soccerwiki_link_refresh as refresh


class SoccerWikiLinkRefreshTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {
            "SUPABASE_URL": "https://example.supabase.co",
            "SUPABASE_KEY": "test-key",
        })
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_skip_photo_fill_routes_photo_writes_to_verified_queue(self):
        with patch.object(refresh, "sb", side_effect=[1, 2, 3]) as rpc:
            result = refresh.main(["--skip-photo-fill"])

        self.assertEqual(result, 0)
        self.assertEqual(rpc.call_count, 3)
        self.assertEqual(
            [call.args[0] for call in rpc.call_args_list],
            [
                "rpc/fill_current_club_resolved_key",
                "rpc/link_soccerwiki_cards",
                "rpc/fill_sw_rating",
            ],
        )

    def test_default_keeps_legacy_four_step_refresh(self):
        with patch.object(refresh, "sb", side_effect=[1, 2, 3, 4]) as rpc:
            result = refresh.main([])

        self.assertEqual(result, 0)
        self.assertEqual(rpc.call_count, 4)
        self.assertEqual(rpc.call_args_list[-1].args[0], "rpc/fill_photo_from_soccerwiki")

    def test_rpc_failure_is_not_reported_as_success(self):
        with patch.object(refresh, "sb", side_effect=[1, None, 3]) as rpc:
            result = refresh.main(["--skip-photo-fill"])

        self.assertEqual(result, 1)
        self.assertEqual(rpc.call_count, 3)


if __name__ == "__main__":
    unittest.main()
