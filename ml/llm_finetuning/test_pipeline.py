import json, tempfile, unittest
from pathlib import Path
from prepare_dataset import load_examples, prepare


def row(i,day,target="home",feature_offset=-1,odds_offset=-1,settled_offset=1):
    return {"fixture_id":f"fixture-{i}","commence_at":f"2026-01-{day:02d}T15:00:00Z",
      "feature_cutoff_at":f"2026-01-{day:02d}T{15+feature_offset:02d}:00:00Z",
      "odds_snapshot_at":f"2026-01-{day:02d}T{15+odds_offset:02d}:00:00Z",
      "settled_at":f"2026-01-{day:02d}T{15+settled_offset:02d}:00:00Z",
      "input_context":{"home_team":"A","away_team":"B","odds":{"home":2.0}},"target_outcome":target}


class FineTuningDataTests(unittest.TestCase):
    def write(self,path,rows): path.write_text("".join(json.dumps(r)+"\n" for r in rows),encoding="utf-8")
    def test_rejects_feature_or_odds_leakage(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/"raw.jsonl"; self.write(path,[row(1,1,feature_offset=0)])
            with self.assertRaisesRegex(ValueError,"temporal leakage"): load_examples(path)
    def test_rejects_duplicates_and_bad_labels(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/"raw.jsonl"; self.write(path,[row(1,1),row(1,2)])
            with self.assertRaisesRegex(ValueError,"duplicate"): load_examples(path)
            self.write(path,[row(2,3,target="unknown")])
            with self.assertRaisesRegex(ValueError,"target_outcome"): load_examples(path)
    def test_splits_chronologically_and_keeps_holdout_local(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/"raw.jsonl"; out=Path(temp)/"out"; self.write(path,[row(i,i) for i in range(1,11)])
            manifest=prepare(str(path),str(out),min_examples=10)
            self.assertEqual(manifest["counts"]["train.jsonl"],7)
            self.assertEqual(manifest["counts"]["validation.jsonl"],1)
            self.assertEqual(manifest["counts"]["holdout.jsonl"],2)
            self.assertTrue(manifest["holdout_is_never_uploaded"])
            train=[json.loads(line) for line in (out/"train.jsonl").read_text().splitlines()]
            self.assertIn('"home_team": "A"',train[0]["messages"][1]["content"])


if __name__=="__main__": unittest.main()
