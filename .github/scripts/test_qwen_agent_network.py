import importlib.util
import unittest

SPEC = importlib.util.spec_from_file_location("qwen_agent_network", ".github/scripts/qwen_agent_network.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def diff(path="src/features/home/Home.tsx", body="+const ready = true;"):
    return (
        f"diff --git a/{path} b/{path}\n"
        "--- a/" + path + "\n"
        "+++ b/" + path + "\n"
        "@@ -1 +1 @@\n"
        "-const ready = false;\n"
        + body + "\n"
    )


class AgentPatchPolicyTests(unittest.TestCase):
    def test_frontend_src_is_writable(self):
        self.assertTrue(MODULE.is_allowed_path("src/features/home/Home.tsx"))

    def test_existing_documented_roots_remain_writable(self):
        for path in ("app/routes.py", "services/worker.py", "test/test_worker.py", "docs/MAP.md", "scripts/check.py"):
            with self.subTest(path=path):
                self.assertTrue(MODULE.is_allowed_path(path))

    def test_rejects_path_traversal_and_sensitive_files(self):
        for path in ("src/../../.env", "src/.env.production", "src/private/token.ts", "src/package-lock.json", "../src/App.tsx", "src\\App.tsx"):
            with self.subTest(path=path):
                self.assertFalse(MODULE.is_allowed_path(path))

    def test_accepts_scoped_frontend_patch(self):
        self.assertEqual(MODULE.validate_patch(diff()), ["src/features/home/Home.tsx"])

    def test_rejects_unapproved_root(self):
        with self.assertRaises(ValueError):
            MODULE.validate_patch(diff("supabase/migrations/001.sql"))

    def test_rejects_deletions(self):
        patch = "diff --git a/src/old.ts b/src/old.ts\ndeleted file mode 100644\n--- a/src/old.ts\n+++ /dev/null\n"
        with self.assertRaises(ValueError):
            MODULE.validate_patch(patch)

    def test_rejects_renames(self):
        patch = "diff --git a/src/a.ts b/src/b.ts\nsimilarity index 100%\nrename from src/a.ts\nrename to src/b.ts\n"
        with self.assertRaises(ValueError):
            MODULE.validate_patch(patch)

    def test_rejects_symlinks(self):
        patch = diff("src/link") .replace("@@ -1 +1 @@", "new file mode 120000\n@@ -0,0 +1 @@")
        with self.assertRaises(ValueError):
            MODULE.validate_patch(patch)

    def test_rejects_more_than_eight_files(self):
        patch = "".join(diff(f"src/file{i}.ts") for i in range(9))
        with self.assertRaises(ValueError):
            MODULE.validate_patch(patch)

    def test_rejects_oversized_patch(self):
        with self.assertRaises(ValueError):
            MODULE.validate_patch("x" * (MODULE.MAX_PATCH_BYTES + 1))


if __name__ == "__main__":
    unittest.main()
