import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import local_model_agent as agent


class LocalModelAgentTests(unittest.TestCase):
    def test_allowlist_blocks_workflows_secrets_and_path_traversal(self):
        tracked = set()
        self.assertTrue(agent.allowed("src/features/example.ts", tracked))
        self.assertTrue(agent.allowed("docs/MAP.md", tracked))
        self.assertFalse(agent.allowed(".github/workflows/unsafe.yml", tracked))
        self.assertFalse(agent.allowed("src/.env.production", tracked))
        self.assertFalse(agent.allowed("src/private-key.pem", tracked))
        self.assertFalse(agent.allowed("../src/escape.ts", tracked))
        self.assertFalse(agent.allowed("/src/absolute.ts", tracked))

    def test_existing_migrations_are_not_mutable(self):
        path = "supabase/migrations/20260101000000_existing.sql"
        self.assertFalse(agent.allowed(path, {path}))

    def test_replace_requires_one_exact_match(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "src").mkdir()
            (root / "src/a.py").write_text("x = 1\ny = 2\n", encoding="utf-8")
            with patch.object(agent, "ROOT", root):
                changed = agent.apply_edits([{"path": "src/a.py", "old": "x = 1", "new": "x = 3"}], {"src/a.py"})
            self.assertEqual(changed, ["src/a.py"])
            self.assertEqual((root / "src/a.py").read_text(encoding="utf-8"), "x = 3\ny = 2\n")

    def test_create_only_for_new_allowed_path(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with patch.object(agent, "ROOT", root):
                changed = agent.apply_edits([{"path": "tests/new_test.py", "old": "", "new": "assert True\n"}], set())
            self.assertEqual(changed, ["tests/new_test.py"])
            self.assertTrue((root / "tests/new_test.py").is_file())

    def test_rejects_ambiguous_snippet_without_writing(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "src").mkdir()
            (root / "src/a.py").write_text("x = 1\nx = 1\n", encoding="utf-8")
            with patch.object(agent, "ROOT", root):
                with self.assertRaises(ValueError):
                    agent.apply_edits([{"path": "src/a.py", "old": "x = 1", "new": "x = 2"}], {"src/a.py"})
            self.assertEqual((root / "src/a.py").read_text(encoding="utf-8"), "x = 1\nx = 1\n")

    def test_rejects_conflicting_edits_before_writing(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "src").mkdir()
            (root / "src/a.py").write_text("x = 1\n", encoding="utf-8")
            with patch.object(agent, "ROOT", root):
                with self.assertRaises(ValueError):
                    agent.apply_edits([
                        {"path": "src/a.py", "old": "x = 1", "new": "x = 2"},
                        {"path": "src/a.py", "old": "x = 1", "new": "x = 3"},
                    ], {"src/a.py"})
            self.assertEqual((root / "src/a.py").read_text(encoding="utf-8"), "x = 1\n")


if __name__ == "__main__":
    unittest.main()
