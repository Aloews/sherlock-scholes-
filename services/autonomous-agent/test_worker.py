import unittest
from worker import extract_patch, safe_path


class WorkerPolicyTests(unittest.TestCase):
    def test_allowed_paths(self):
        self.assertTrue(safe_path("src/features/example.ts"))
        self.assertTrue(safe_path("services/football-dynasty/src/main.rs"))
        self.assertTrue(safe_path("docs/MAP.md"))

    def test_restricted_paths(self):
        for path in (
            ".github/workflows/ci.yml",
            "services/autonomous-agent/worker.py",
            "package.json",
            "package-lock.json",
            "supabase/.env",
            "docs/../.env",
            "../../src/secret.ts",
            "/src/absolute.ts",
            "src/.env.production",
        ):
            self.assertFalse(safe_path(path), path)

    def test_accepts_simple_patch(self):
        patch = (
            "diff --git a/src/example.ts b/src/example.ts\n"
            "index 1234567..7654321 100644\n"
            "--- a/src/example.ts\n"
            "+++ b/src/example.ts\n"
            "@@ -1 +1 @@\n-old\n+new\n"
        )
        self.assertEqual(extract_patch(patch), patch)

    def test_rejects_workflow_patch(self):
        patch = (
            "diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml\n"
            "--- a/.github/workflows/ci.yml\n+++ b/.github/workflows/ci.yml\n"
            "@@ -1 +1 @@\n-a\n+b\n"
        )
        with self.assertRaises(RuntimeError):
            extract_patch(patch)

    def test_rejects_deletion(self):
        patch = (
            "diff --git a/src/example.ts b/src/example.ts\n"
            "--- a/src/example.ts\n+++ /dev/null\n"
            "@@ -1 +0,0 @@\n-old\n"
        )
        with self.assertRaises(RuntimeError):
            extract_patch(patch)


if __name__ == "__main__":
    unittest.main()
