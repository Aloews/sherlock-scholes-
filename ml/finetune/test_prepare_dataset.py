import json
import pathlib
import sys
import tempfile
import unittest
from datetime import date

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from prepare_dataset import prepare, validate_record


def example(day, fixture):
    return {
        "match_date": day,
        "fixture_id": fixture,
        "messages": [
            {"role": "user", "content": "Analyze this match from pre-match information."},
            {"role": "assistant", "content": "Insufficient evidence for a confident pick."},
        ],
    }


class PrepareDatasetTests(unittest.TestCase):
    def test_temporal_split_and_deduplication(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            source = root / "source.jsonl"
            source.write_text("\n".join(json.dumps(row) for row in [
                example("2024-01-01", "a"),
                example("2024-01-01", "a"),
                example("2025-02-01", "b"),
                example("2026-02-01", "c"),
            ]) + "\n", encoding="utf-8")
            manifest = prepare(source, root / "out", date(2024, 12, 31), date(2025, 12, 31))
            self.assertEqual(manifest["counts"], {"train": 1, "validation": 1, "test": 1})
            self.assertTrue((root / "out" / "manifest.json").is_file())

    def test_requires_assistant_final_turn(self):
        row = example("2024-01-01", "a")
        row["messages"][-1]["role"] = "user"
        with self.assertRaises(ValueError):
            validate_record(row, 1)

    def test_invalid_date_rejected(self):
        with self.assertRaises(ValueError):
            validate_record(example("not-a-date", "a"), 1)


if __name__ == "__main__":
    unittest.main()
