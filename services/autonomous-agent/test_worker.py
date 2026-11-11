import os
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from worker import compose_issue_task, extract_patch, run_command, safe_path


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

    def test_repository_specific_paths_survive_final_policy(self):
        from worker import allowed_prefixes_for_repo

        self.assertTrue(safe_path(
            "api/management-webhook.ts",
            allowed_prefixes_for_repo("Aloews/sherlock-ai-bot"),
        ))
        self.assertTrue(safe_path(
            "pages/index.tsx",
            allowed_prefixes_for_repo("Aloews/russian-dev-projects"),
        ))
        self.assertFalse(safe_path(
            "api/management-webhook.ts",
            allowed_prefixes_for_repo("Aloews/sherlock-scholes-"),
        ))

    def test_issue_title_and_description_are_included_in_task(self):
        task = compose_issue_task(
            {"title": "Fix player card", "body": "The card shows the wrong season total."},
            "Implement the issue and add tests",
        )
        self.assertIn("Owner command: Implement the issue and add tests", task)
        self.assertIn("Issue title: Fix player card", task)
        self.assertIn("wrong season total", task)

    def test_issue_description_is_bounded(self):
        task = compose_issue_task({"body": "x" * 20000}, "Fix")
        self.assertLess(len(task), 8100)

    def test_worker_uses_repository_default_branch(self):
        from worker import Worker

        worker = Worker.__new__(Worker)
        worker.repo = "Aloews/example"
        worker.owner = "Aloews"
        worker.default_branch = "trunk"
        worker.token = "test-token"
        with patch("worker.request_json", side_effect=[
            [], {"html_url": "https://github.com/Aloews/example/pull/7"}, {},
        ]) as request:
            result = worker._create_pr(7, 99, "ai/task-7-99", "https://github.com/Aloews/example/issues/7#issuecomment-99")
        self.assertTrue(result.endswith("/pull/7"))
        self.assertEqual(request.call_args_list[1].args[0], "https://api.github.com/repos/Aloews/example/pulls")
        self.assertEqual(request.call_args_list[1].args[3]["base"], "trunk")

    def test_unknown_repository_is_not_allowed(self):
        from worker import allowed_prefixes_for_repo

        with self.assertRaises(RuntimeError):
            allowed_prefixes_for_repo("Aloews/not-on-the-allowlist")

    def test_starimg_model_catalog_selects_coding_model_without_completion(self):
        from worker import choose_model

        with patch("worker.starimg_request", return_value={
            "data": [{"id": "general-chat"}, {"id": "qwen3-coder-plus"}]
        }) as request:
            self.assertEqual(
                choose_model("https://ai.starimg.ru/v1", "test-key"),
                "qwen3-coder-plus",
            )
        request.assert_called_once_with(
            "https://ai.starimg.ru/v1", "test-key", "/models", timeout=30
        )

    def test_starimg_explicit_model_must_exist_in_catalog(self):
        from worker import choose_model

        with patch.dict(os.environ, {"STARIMG_MODEL": "unknown-model"}):
            with patch("worker.starimg_request", return_value={
                "data": [{"id": "qwen3-coder-plus"}]
            }):
                with self.assertRaises(RuntimeError):
                    choose_model("https://ai.starimg.ru/v1", "test-key")


if __name__ == "__main__":
    unittest.main()
