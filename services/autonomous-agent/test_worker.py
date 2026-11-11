import os
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from worker import extract_patch, run_command, safe_path


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

    def test_subprocess_environment_excludes_all_service_secrets(self):
        with patch.dict(os.environ, {
            "SUPABASE_DB_URL": "postgresql://secret",
            "SUPABASE_ACCESS_TOKEN": "supabase-secret",
            "VERCEL_TOKEN": "vercel-secret",
            "STARIMG_API_KEY": "starimg-secret",
            "GITHUB_TOKEN": "github-secret",
            "M3U_SOURCE_URL": "https://private.example/playlist",
        }, clear=True):
            with patch("worker.subprocess.run") as mocked:
                mocked.return_value = SimpleNamespace(returncode=0, stdout="")
                run_command(["true"], Path("/tmp"))
                child_env = mocked.call_args.kwargs["env"]
                for secret_name in (
                    "SUPABASE_DB_URL", "SUPABASE_ACCESS_TOKEN", "VERCEL_TOKEN",
                    "STARIMG_API_KEY", "GITHUB_TOKEN", "M3U_SOURCE_URL",
                ):
                    self.assertNotIn(secret_name, child_env)

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


    def test_repository_scoped_path_policies(self):
        from worker import allowed_prefixes_for_repo

        self.assertTrue(safe_path("api/management-webhook.ts",
                                  allowed_prefixes_for_repo("Aloews/sherlock-ai-bot")))
        self.assertTrue(safe_path("src/features/stream/player.ts",
                                  allowed_prefixes_for_repo("Aloews/sherlock-tv")))
        self.assertTrue(safe_path("pages/README-Game.md",
                                  allowed_prefixes_for_repo("Aloews/russian-dev-projects")))
        self.assertFalse(safe_path("api/management-webhook.ts",
                                   allowed_prefixes_for_repo("Aloews/sherlock-scholes-")))
        self.assertFalse(safe_path("package.json",
                                   allowed_prefixes_for_repo("Aloews/Novel-forge")))

    def test_unknown_repository_is_not_allowed(self):
        from worker import allowed_prefixes_for_repo

        with self.assertRaises(RuntimeError):
            allowed_prefixes_for_repo("Aloews/not-on-the-allowlist")
