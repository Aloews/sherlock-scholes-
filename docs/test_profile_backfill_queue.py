import sys
import subprocess
import unittest
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import profile_backfill_queue as worker
from profile_backfill_queue import classify_result, usable_photo, rpc_status, result_exit_code, final_job_results


class SoccerWikiPhotoTests(unittest.TestCase):
    card_id = "642fc812-0b0b-4902-8cd1-7e178da734de"

    def run_photo_sw(self, card, profiles, reachable=True):
        url = next((row["photo_url"] for row in profiles if row.get("photo_url")), None)
        writes = []

        def fake_request(path, params=None, method="GET", body=None):
            if path == "cards" and method == "GET" and params.get("select") == "id,name,name_en,country,photo_url":
                return [card]
            if path == "soccerwiki_player":
                return profiles
            if path == "cards" and method == "PATCH":
                writes.append(body["photo_url"])
                return [{"id": self.card_id, "photo_url": body["photo_url"]}]
            if path == "cards":
                return [{"id": self.card_id, "photo_url": writes[-1] if writes else None}]
            raise AssertionError(f"unexpected request: {path} {method} {params}")

        with patch("profile_backfill_queue.request", side_effect=fake_request), patch(
            "profile_backfill_queue.image_reachable", return_value=reachable
        ):
            output, exit_code = worker.run_collector({"task_type": "photo_sw", "card_id": self.card_id})
        return output, exit_code, writes

    def test_photo_sw_writes_and_verifies_identity_matched_source(self):
        url = "https://cdn.soccerwiki.org/images/player/149111.png"
        card = {"id": self.card_id, "name": "Саид Эль-Мала", "name_en": "Saïd El Mala", "country": "DE"}
        profile = {"name": "Saïd El Mala", "full_name": "Saïd El Mala", "photo_url": url, "nation_code": "GER"}
        output, exit_code, writes = self.run_photo_sw(card, [profile])

        self.assertEqual(exit_code, 0)
        self.assertEqual(writes, [url])
        self.assertIn("Фото найдено: 1", output)
        self.assertIn("Источник: Soccer Wiki", output)

    def test_photo_sw_selects_matching_row_not_first_duplicate(self):
        url = "https://cdn.soccerwiki.org/images/player/50841.png"
        card = {"id": self.card_id, "name": "Diego Rodríguez", "name_en": "Diego Rodríguez", "country": "ES"}
        profiles = [
            {"name": "Dominik Sarapata", "full_name": "Dominik Sarapata",
             "photo_url": "https://cdn.soccerwiki.org/images/player/153517.png", "nation_code": "POL"},
            {"name": "Diego Rodríguez", "full_name": "Diego Martín Rodríguez",
             "photo_url": url, "nation_code": "ESP"},
        ]
        output, exit_code, writes = self.run_photo_sw(card, profiles)

        self.assertEqual(exit_code, 0)
        self.assertEqual(writes, [url])
        self.assertIn("Источник: Soccer Wiki", output)

    def test_photo_sw_rejects_wrong_person_even_when_photo_is_reachable(self):
        card = {"id": self.card_id, "name": "Tobias Breum-Harild",
                "name_en": "Tobias Breum-Harild", "country": "DK"}
        profiles = [{"name": "Dominik Sarapata", "full_name": "Dominik Sarapata",
                     "photo_url": "https://cdn.soccerwiki.org/images/player/153517.png",
                     "nation_code": "POL"}]
        output, exit_code, writes = self.run_photo_sw(card, profiles)

        self.assertEqual(exit_code, 0)
        self.assertEqual(writes, [])
        self.assertEqual(classify_result(exit_code, output, False), "no_data")

    def test_photo_sw_rejects_country_conflict(self):
        card = {"id": self.card_id, "name": "Diego Rodríguez",
                "name_en": "Diego Rodríguez", "country": "ES"}
        profiles = [{"name": "Diego Rodríguez", "full_name": "Diego Martín Rodríguez",
                     "photo_url": "https://cdn.soccerwiki.org/images/player/50841.png",
                     "nation_code": "ARG"}]
        output, exit_code, writes = self.run_photo_sw(card, profiles)

        self.assertEqual(exit_code, 0)
        self.assertEqual(writes, [])
        self.assertEqual(classify_result(exit_code, output, False), "no_data")

    def test_photo_sw_unreachable_source_is_retryable(self):
        url = "https://cdn.soccerwiki.org/images/player/149111.png"
        card = {"id": self.card_id, "name": "Player One", "name_en": "Player One", "country": None}
        profile = {"name": "Player One", "full_name": "Player One", "photo_url": url, "nation_code": None}
        output, exit_code, writes = self.run_photo_sw(card, [profile], reachable=False)

        self.assertNotEqual(exit_code, 0)
        self.assertEqual(writes, [])
        self.assertEqual(classify_result(exit_code, output, False), "retry")

    def test_photo_sw_missing_source_is_no_data(self):
        card = {"id": self.card_id, "name": "Player One", "name_en": "Player One", "country": None}
        output, exit_code, writes = self.run_photo_sw(card, [])

        self.assertEqual(exit_code, 0)
        self.assertEqual(writes, [])
        self.assertEqual(classify_result(exit_code, output, False), "no_data")



class TransfermarktFallbackTests(unittest.TestCase):
    def test_queued_transfermarkt_job_bypasses_soccwerwiki_bulk_skip(self):
        completed = subprocess.CompletedProcess(
            args=[], returncode=0, stdout="Портретов найдено : 0\\n"
        )
        job = {
            "task_type": "photo_tm",
            "transfermarkt_id": "273236",
            "card_id": "642fc812-0b0b-4902-8cd1-7e178da734de",
        }
        with patch("profile_backfill_queue.subprocess.run", return_value=completed) as run:
            output, exit_code = worker.run_collector(job)

        self.assertEqual(exit_code, 0)
        self.assertIn("--include-soccerwiki", run.call_args.args[0])
        self.assertIn("Портретов найдено", output)


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
        # A transient failure followed by a successful retry is a success overall.
        self.assertEqual(result_exit_code([
            {"job_id": 44, "status": "pending"},
            {"job_id": 44, "status": "succeeded"},
        ]), 0)
        self.assertEqual(result_exit_code([
            {"job_id": 44, "status": "succeeded"},
            {"job_id": 44, "status": "pending"},
        ]), 1)
        self.assertEqual(len(final_job_results([
            {"job_id": 44, "status": "pending"},
            {"job_id": 44, "status": "succeeded"},
            {"job_id": 45, "status": "no_data"},
        ])), 2)

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
