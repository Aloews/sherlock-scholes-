import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from worker import compose_issue_task, context_excerpt, extract_patch, missing_required_paths, patch_file_context, required_paths_from_task, run_command, safe_path, starimg_request, starimg_stream_completion, starimg_anthropic_stream_completion, ask_starimg


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

    def test_required_file_gate_extracts_all_declared_paths(self):
        task = """Required files — all six must be changed in the same PR
- `services/football-dynasty/migrations/0005_squad_contracts.sql`
- `services/football-dynasty/src/roster.rs`
- `services/football-dynasty/src/lib.rs`
- `services/football-dynasty/src/http.rs`
- `services/football-dynasty/tests/campaign_lifecycle.rs`
- `docs/MAP.md`"""
        required = required_paths_from_task(task)
        self.assertEqual(len(required), 6)
        self.assertEqual(
            missing_required_paths(required, [required[0]]),
            sorted(required[1:]),
        )

    def test_required_file_gate_allows_complete_change_set(self):
        required = ["services/football-dynasty/src/roster.rs", "docs/MAP.md"]
        self.assertEqual(missing_required_paths(required, required), [])

    def test_context_excerpt_preserves_file_head_and_tail(self):
        body = "BEGIN\n" + ("x" * 12000) + "\nEND"
        excerpt = context_excerpt(body, limit=200)
        self.assertTrue(excerpt.startswith("BEGIN"))
        self.assertTrue(excerpt.endswith("END"))
        self.assertIn("middle omitted", excerpt)

    def test_rejected_patch_context_contains_exact_current_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / "src" / "example.rs"
            target.parent.mkdir(parents=True)
            target.write_text("pub fn current() {}\n", encoding="utf-8")
            patch = (
                "diff --git a/src/example.rs b/src/example.rs\n"
                "--- a/src/example.rs\n"
                "+++ b/src/example.rs\n"
                "@@ -1 +1 @@\n-old\n+new\n"
            )
            context = patch_file_context(root, patch)
            self.assertIn("EXACT CURRENT FILE CONTENT AFTER RESET: src/example.rs", context)
            self.assertIn("pub fn current() {}", context)

    def test_rejected_patch_context_keeps_middle_of_large_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / "src" / "large.rs"
            target.parent.mkdir(parents=True)
            body = "HEAD\\n" + ("x" * 9000) + "\\nMIDDLE_ANCHOR\\n" + ("y" * 9000) + "\\nTAIL\\n"
            target.write_text(body, encoding="utf-8")
            patch = (
                "diff --git a/src/large.rs b/src/large.rs\\n"
                "--- a/src/large.rs\\n+++ b/src/large.rs\\n"
                "@@ -1 +1 @@\\n-old\\n+new\\n"
            )
            context = patch_file_context(root, patch)
            self.assertIn("MIDDLE_ANCHOR", context)
            self.assertIn("HEAD", context)
            self.assertIn("TAIL", context)

    def test_extract_patch_removes_trailing_whitespace_from_added_lines(self):
        patch = (
            "diff --git a/src/example.rs b/src/example.rs\\n"
            "--- a/src/example.rs\\n+++ b/src/example.rs\\n"
            "@@ -1 +1 @@\\n-old\\n+new value   \\n"
        )
        extracted = extract_patch(patch)
        self.assertIn("+new value\\n", extracted)
        self.assertNotIn("+new value   ", extracted)

    def test_extract_patch_strips_apply_patch_sentinels(self):
        patch = (
            "*** Begin Patch\n"
            "diff --git a/src/example.ts b/src/example.ts\n"
            "--- a/src/example.ts\n"
            "+++ b/src/example.ts\n"
            "@@ -1 +1 @@\n-old\n+new\n"
            "*** End Patch\n"
        )
        extracted = extract_patch(patch)
        self.assertTrue(extracted.startswith("diff --git a/src/example.ts"))
        self.assertNotIn("*** Begin Patch", extracted)
        self.assertNotIn("*** End Patch", extracted)

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

    def test_starimg_completion_uses_five_minute_read_timeout(self):
        with patch("worker.urllib.request.urlopen") as urlopen:
            urlopen.return_value.__enter__.return_value.read.return_value = b'{"ok":true}'
            self.assertEqual(
                starimg_request("https://ai.starimg.ru/v1", "test-key", "/chat/completions", {"model": "test"}),
                {"ok": True},
            )
        self.assertEqual(urlopen.call_args.kwargs["timeout"], 300)

    def test_starimg_streaming_completion_collects_sse_deltas_and_usage(self):
        events = [
            {"choices": [{"delta": {"content": "diff --git "}}]},
            {"choices": [{"delta": {"content": "a/src/a.ts b/src/a.ts\n"}}]},
            {"choices": [], "usage": {"prompt_tokens": 12, "completion_tokens": 8}},
        ]
        payload = b"".join(
            ("data: " + json.dumps(event) + "\n\n").encode("utf-8")
            for event in events
        ) + b"data: [DONE]\n\n"
        with patch("worker.urllib.request.urlopen", return_value=io.BytesIO(payload)) as urlopen:
            result = starimg_stream_completion(
                "https://ai.starimg.ru/v1", "test-key",
                {"model": "test-model", "messages": []},
            )
        self.assertEqual(result["choices"][0]["message"]["content"],
                         "diff --git a/src/a.ts b/src/a.ts\n")
        self.assertEqual(result["usage"]["completion_tokens"], 8)
        self.assertTrue(urlopen.call_args.kwargs["timeout"] >= 180)

    def test_starimg_anthropic_streaming_completion_collects_text_and_usage(self):
        events = [
            {"type": "message_start", "message": {"usage": {"input_tokens": 12, "output_tokens": 0}}},
            {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "diff --git "}},
            {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "a/src/a.ts b/src/a.ts\n"}},
            {"type": "message_delta", "usage": {"output_tokens": 8}},
            {"type": "message_stop"},
        ]
        payload = b"".join(
            ("event: " + event["type"] + "\ndata: " + json.dumps(event) + "\n\n").encode("utf-8")
            for event in events
        )
        with patch("worker.urllib.request.urlopen", return_value=io.BytesIO(payload)) as urlopen:
            result = starimg_anthropic_stream_completion(
                "https://ai.starimg.ru/v1", "test-key",
                {"model": "claude-opus-5", "messages": []},
            )
        self.assertEqual(
            result["choices"][0]["message"]["content"],
            "diff --git a/src/a.ts b/src/a.ts\n",
        )
        self.assertEqual(result["usage"]["input_tokens"], 12)
        self.assertEqual(result["usage"]["output_tokens"], 8)
        request = urlopen.call_args.args[0]
        self.assertTrue(request.full_url.endswith("/v1/messages"))
        self.assertEqual(request.get_header("X-api-key"), "test-key")
        self.assertEqual(request.get_header("Anthropic-version"), "2023-06-01")

    def test_ask_starimg_uses_anthropic_messages_for_claude_models(self):
        from worker import ask_starimg

        with patch("worker.starimg_anthropic_stream_completion", return_value={
            "choices": [{"message": {"content": "diff --git a/src/a.ts b/src/a.ts\n"}}],
            "usage": {"input_tokens": 10, "output_tokens": 5},
        }) as completion:
            answer, usage = ask_starimg(
                "https://ai.starimg.ru/v1", "test-key", "claude-opus-5",
                "Implement task", 394, "repo context", ("src/",),
            )
        self.assertTrue(answer.startswith("diff --git"))
        self.assertEqual(usage["output_tokens"], 5)
        payload = completion.call_args.args[2]
        self.assertEqual(payload["model"], "claude-opus-5")
        self.assertIn("system", payload)
        self.assertEqual(payload["messages"][0]["role"], "user")
        self.assertTrue(completion.call_args.args[0].endswith("/v1"))

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

    def test_starimg_prefers_claude_sonnet_over_general_gpt_model(self):
        from worker import choose_model

        with patch("worker.starimg_request", return_value={
            "data": [{"id": "gpt-6-luna"}, {"id": "claude-sonnet-5.5"}]
        }):
            self.assertEqual(
                choose_model("https://ai.starimg.ru/v1", "test-key"),
                "claude-sonnet-5.5",
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
