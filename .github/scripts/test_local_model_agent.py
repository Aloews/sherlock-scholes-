import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import local_model_agent as agent


class LocalModelAgentTests(unittest.TestCase):
    def test_parse_json_response_and_fenced_json(self):
        expected = [{"operation": "replace", "path": "src/a.py", "old": "x = 1", "new": "x = 2"}]
        self.assertEqual(agent.parse_edits('{"changes":' + __import__("json").dumps(expected) + '}'), expected)
        self.assertEqual(agent.parse_edits('```json\n{"changes":' + __import__("json").dumps(expected) + '}\n```'), expected)

    def test_rejects_unified_diff_and_non_json(self):
        with self.assertRaises(ValueError):
            agent.parse_edits("diff --git a/src/a.py b/src/a.py")

    def test_replace_requires_one_exact_match(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "src").mkdir()
            (root / "src/a.py").write_text("x = 1\ny = 2\n", encoding="utf-8")
            changed = agent.apply_changes(root, [{
                "operation": "replace", "path": "src/a.py", "old": "x = 1", "new": "x = 3"
            }], run_git_check=False)
            self.assertEqual(changed, ["src/a.py"])
            self.assertEqual((root / "src/a.py").read_text(encoding="utf-8"), "x = 3\ny = 2\n")

    def test_rejects_ambiguous_or_missing_old_snippet(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "src").mkdir()
            (root / "src/a.py").write_text("x = 1\nx = 1\n", encoding="utf-8")
            with self.assertRaises(ValueError):
                agent.apply_changes(root, [{
                    "operation": "replace", "path": "src/a.py", "old": "x = 1", "new": "x = 2"
                }])

    def test_create_only_for_new_allowed_path(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            changed = agent.apply_changes(root, [{
                "operation": "create", "path": "tests/new_test.py", "content": "assert True\n"
            }])
            self.assertEqual(changed, ["tests/new_test.py"])
            self.assertTrue((root / "tests/new_test.py").is_file())

    def test_rejects_path_traversal_and_restricted_paths(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for path in ("src/../.env", "../src/a.py", ".github/workflows/evil.yml", "package.json"):
                with self.subTest(path=path):
                    with self.assertRaises(ValueError):
                        agent.apply_changes(root, [{
                            "operation": "create", "path": path, "content": "bad"
                        }])

    def test_rejects_duplicate_paths_before_writing(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            changes = [
                {"operation": "create", "path": "src/a.py", "content": "a"},
                {"operation": "create", "path": "src/a.py", "content": "b"}
            ]
            with self.assertRaises(ValueError):
                agent.apply_changes(root, changes)
            self.assertFalse((root / "src/a.py").exists())


if __name__ == "__main__":
    unittest.main()
