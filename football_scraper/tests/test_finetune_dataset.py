import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from prepare_finetune_dataset import split_records, validate_records


def example(event_number, day):
    return {
        "event_id": "event-%02d" % event_number,
        "event_time": "2025-01-%02dT12:00:00Z" % day,
        "source_ids": ["fixture:event-%02d" % event_number],
        "messages": [
            {"role": "system", "content": "Analyse football data without inventing facts."},
            {"role": "user", "content": "Analyse event %02d." % event_number},
            {"role": "assistant", "content": "Evidence-based answer for event %02d." % event_number},
        ],
    }


class FineTuneDatasetTests(unittest.TestCase):
    def test_splits_by_event_time_without_event_leakage(self):
        rows = validate_records([example(i, i) for i in range(1, 21)])
        split = split_records(rows)
        self.assertTrue(split["train"])
        self.assertTrue(split["validation"])
        self.assertTrue(split["test"])
        event_sets = {key: {row["event_id"] for row in value} for key, value in split.items()}
        self.assertFalse(event_sets["train"] & event_sets["validation"])
        self.assertFalse(event_sets["train"] & event_sets["test"])
        self.assertFalse(event_sets["validation"] & event_sets["test"])

    def test_duplicate_chat_is_removed(self):
        item = example(1, 1)
        changed_event = dict(item, event_id="event-duplicate", event_time="2025-01-21T12:00:00Z")
        rows = validate_records([item] + [example(i, i) for i in range(2, 21)] + [changed_event])
        self.assertEqual(len(rows), 20)

    def test_requires_source_provenance(self):
        item = example(1, 1)
        item["source_ids"] = []
        with self.assertRaises(ValueError):
            validate_records([item] + [example(i, i) for i in range(2, 21)])

    def test_rejects_timezone_free_timestamps(self):
        item = example(1, 1)
        item["event_time"] = "2025-01-01T12:00:00"
        with self.assertRaises(ValueError):
            validate_records([item] + [example(i, i) for i in range(2, 21)])


if __name__ == "__main__":
    unittest.main()
