import json
import tempfile
import unittest
from pathlib import Path
from evaluate_predictions import evaluate


class EvaluationTests(unittest.TestCase):
    def test_accuracy_and_probability_metrics(self):
        rows=[
          {"actual_outcome":"home","predicted_outcome":"home","probabilities":{"home":0.7,"draw":0.2,"away":0.1}},
          {"actual_outcome":"draw","predicted_outcome":"home","probabilities":{"home":0.2,"draw":0.6,"away":0.2}},
        ]
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/"predictions.jsonl"
            path.write_text("".join(json.dumps(row)+"\n" for row in rows),encoding="utf-8")
            result=evaluate(path,minimum=2)
            self.assertEqual(result["correct"],1)
            self.assertEqual(result["n"],2)
            self.assertGreater(result["brier_score"],0)
            self.assertGreater(result["log_loss"],0)

    def test_rejects_non_normalized_probabilities(self):
        row={"actual_outcome":"home","predicted_outcome":"home","probabilities":{"home":0.9,"draw":0.9,"away":0.9}}
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/"predictions.jsonl"; path.write_text(json.dumps(row)+"\n",encoding="utf-8")
            with self.assertRaisesRegex(ValueError,"sum"): evaluate(path,minimum=1)


if __name__=="__main__": unittest.main()
