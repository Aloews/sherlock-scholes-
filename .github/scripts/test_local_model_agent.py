import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import local_model_agent as agent


class LocalModelAgentTests(unittest.TestCase):
    def test_parse_json_edits(self):
        expected = [{"path": "src/a.py", "old": "x = 1", "new": "x = 2"}]
        self.assertEqual(agent.parse_edits(json.dumps({"edits": expected})), expected)

    def test_rejects_unified_diff_and_non_object_json(self):
        for raw in ("diff --git a/src/a.py b/src/a.py", '["not", "an", "object"]', '{"changes": []}'):
            with self.subTest(raw=raw):
                with self.assertRaises(ValueError):
                    agent.parse_edits(raw)

    def test_replace_requires_one_exact_match(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "src").mkdir()
            (root / "src/a.py").write_text("x = 1\ny = 2\n", encoding="utf-8")
            changed = agent.apply_edits([{"path": "src/a.py", "old": "x = 1", "new": "x = 3"}], set(), root)
            self.assertEqual(changed, ["src/a.py"])
            self.assertEqual((root / "src/a.py").read_text(encoding="utf-8"), "x = 3\ny = 2\n")

    def test_rejects_ambiguous_or_missing_old_snippet(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "src").mkdir()
            (root / "src/a.py").write_text("x = 1\nx = 1\n", encoding="utf-8")
            with self.assertRaises(ValueError):
                agent.apply_edits([{"path": "src/a.py", "old": "x = 1", "new": "x = 2"}], set(), root)

    def test_create_only_for_new_allowed_path(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            changed = agent.apply_edits([{"path": "tests/new_test.py", "old": "", "new": "assert True\n"}], set(), root)
            self.assertEqual(changed, ["tests/new_test.py"])
            self.assertTrue((root / "tests/new_test.py").is_file())

    def test_rejects_path_traversal_and_restricted_paths(self):
        for path in ("src/../.env", "../src/a.py", ".github/workflows/evil.yml", "package.json"):
            with self.subTest(path=path):
                self.assertFalse(agent.allowed(path, set()))

    def test_rejects_conflicting_edits_before_writing(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "src").mkdir()
            (root / "src/a.py").write_text("x = 1\n", encoding="utf-8")
            with self.assertRaises(ValueError):
                agent.apply_edits([
                    {"path": "src/a.py", "old": "x = 1", "new": "x = 2"},
                    {"path": "src/a.py", "old": "x = 1", "new": "x = 3"},
                ], set(), root)
            self.assertEqual((root / "src/a.py").read_text(encoding="utf-8"), "x = 1\n")


if __name__ == "__main__":
    unittest.main()
