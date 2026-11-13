import io
import json
import os
import tempfile
import unittest
import urllib.error
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from worker import compose_issue_task, context_excerpt, extract_patch, missing_required_paths, patch_file_context, required_paths_from_task, run_command, safe_path, starimg_request, extract_single_file_patch, starimg_stream_completion, starimg_anthropic_stream_completion, ask_starimg, extract_full_file_content, write_full_file_content, github_actions_check_summary


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
            body = "HEAD\n" + ("x" * 9000) + "\nMIDDLE_ANCHOR\n" + ("y" * 9000) + "\nTAIL\n"
            target.write_text(body, encoding="utf-8")
            patch = (
                "diff --git a/src/large.rs b/src/large.rs\n"
                "--- a/src/large.rs\n+++ b/src/large.rs\n"
                "@@ -1 +1 @@\n-old\n+new\n"
            )
            context = patch_file_context(root, patch)
            self.assertIn("MIDDLE_ANCHOR", context)
            self.assertIn("HEAD", context)
            self.assertIn("TAIL", context)

    def test_rejected_patch_context_prioritizes_required_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, marker_text in (
                ("patch.rs", "PATCH_FILE_CONTEXT"),
                ("required.rs", "REQUIRED_FILE_CONTEXT"),
            ):
                target = root / "src" / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(marker_text + "\n", encoding="utf-8")
            patch = (
                "diff --git a/src/patch.rs b/src/patch.rs\n"
                "--- a/src/patch.rs\n+++ b/src/patch.rs\n"
                "@@ -1 +1 @@\n-old\n+new\n"
            )
            context = patch_file_context(root, patch, extra_paths=["src/required.rs"])
            self.assertLess(context.index("REQUIRED_FILE_CONTEXT"), context.index("PATCH_FILE_CONTEXT"))

    def test_extract_patch_removes_trailing_whitespace_from_added_lines(self):
        patch = (
            "diff --git a/src/example.rs b/src/example.rs\n"
            "--- a/src/example.rs\n+++ b/src/example.rs\n"
            "@@ -1 +1 @@\n-old\n+new value   \n"
        )
        extracted = extract_patch(patch)
        self.assertIn("+new value\n", extracted)
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
            [], {"html_url": "https://github.com/Aloews/example/pull/7", "draft": True},
        ]) as request:
            result = worker._create_pr(7, 99, "ai/task-7-99", "https://github.com/Aloews/example/issues/7#issuecomment-99")
        self.assertTrue(result["html_url"].endswith("/pull/7"))
        self.assertTrue(request.call_args_list[1].args[3]["draft"])
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

    def test_starimg_anthropic_completion_accepts_json_message_fallback(self):
        document = {
            "type": "message",
            "content": [{"type": "text", "text": "diff --git a/src/a.rs b/src/a.rs\n"}],
            "usage": {"input_tokens": 21, "output_tokens": 13},
        }
        payload = json.dumps(document).encode("utf-8")
        with patch("worker.urllib.request.urlopen", return_value=io.BytesIO(payload)) as urlopen:
            result = starimg_anthropic_stream_completion(
                "https://ai.starimg.ru/v1", "test-key",
                {"model": "claude-fable-5-2", "messages": [], "stream": False},
            )
        self.assertEqual(
            result["choices"][0]["message"]["content"],
            "diff --git a/src/a.rs b/src/a.rs\n",
        )
        self.assertEqual(result["usage"]["output_tokens"], 13)
        request = urlopen.call_args.args[0]
        self.assertEqual(json.loads(request.data)["stream"], False)
        self.assertEqual(request.get_header("Accept"), "application/json")

    def test_starimg_anthropic_completion_accepts_text_block_start(self):
        events = [
            {"type": "content_block_start", "content_block": {"type": "text", "text": "diff --git "}},
            {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "a/src/a.rs b/src/a.rs\n"}},
            {"type": "message_stop"},
        ]
        payload = b"".join(
            ("event: " + event["type"] + "\ndata: " + json.dumps(event) + "\n\n").encode("utf-8")
            for event in events
        )
        with patch("worker.urllib.request.urlopen", return_value=io.BytesIO(payload)):
            result = starimg_anthropic_stream_completion(
                "https://ai.starimg.ru/v1", "test-key",
                {"model": "claude-fable-5-2", "messages": []},
            )
        self.assertEqual(
            result["choices"][0]["message"]["content"],
            "diff --git a/src/a.rs b/src/a.rs\n",
        )

    def test_anthropic_empty_text_diagnostic_includes_http_status_and_body_metadata(self):
        events = [
            {"type": "message_start", "message": {"usage": {"input_tokens": 12}}},
            {"type": "content_block_start", "content_block": {"type": "thinking"}},
            {
                "type": "message_delta",
                "delta": {"stop_reason": "end_turn"},
                "usage": {"output_tokens": 0},
            },
            {"type": "message_stop"},
        ]
        payload = b"".join(
            ("event: " + event["type"] + "\ndata: " + json.dumps(event) + "\n\n").encode("utf-8")
            for event in events
        )

        class DiagnosticResponse(io.BytesIO):
            status = 200
            headers = {
                "content-type": "text/event-stream",
                "request-id": "req-no-text-001",
            }

        with patch(
            "worker.urllib.request.urlopen",
            return_value=DiagnosticResponse(payload),
        ):
            with self.assertRaises(RuntimeError) as raised:
                starimg_anthropic_stream_completion(
                    "https://ai.starimg.ru/v1",
                    "test-key",
                    {"model": "claude-fable-5-2", "messages": []},
                )

        message = str(raised.exception)
        self.assertIn("HTTP 200", message)
        self.assertIn("req-no-text-001", message)
        self.assertIn("thinking", message)
        self.assertIn("end_turn", message)
        self.assertIn("body_bytes=", message)

    def test_anthropic_sse_response_stops_at_message_stop_even_for_json_mode(self):
        events = [
            {"type": "message_start", "message": {"usage": {"input_tokens": 8}}},
            {"type": "content_block_start", "content_block": {"type": "text"}},
            {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "OK"}},
            {"type": "message_delta", "delta": {"stop_reason": "end_turn"}, "usage": {"output_tokens": 1}},
            {"type": "message_stop"},
            {"type": "provider_tail", "text": "must not be read"},
        ]
        payload = b"".join(
            ("event: " + event["type"] + "\ndata: " + json.dumps(event) + "\n\n").encode("utf-8")
            for event in events
        )

        class SseResponse(io.BytesIO):
            status = 200
            headers = {
                "content-type": "text/event-stream",
                "request-id": "req-json-mode-sse",
            }

            def read(self, *args, **kwargs):
                raise AssertionError("SSE response must stop on message_stop, not read to EOF")

        with patch(
            "worker.urllib.request.urlopen",
            return_value=SseResponse(payload),
        ) as urlopen:
            result = starimg_anthropic_stream_completion(
                "https://ai.starimg.ru/v1",
                "test-key",
                {"model": "claude-fable-5-2", "stream": False, "messages": []},
            )

        self.assertEqual(result["choices"][0]["message"]["content"], "OK")
        request = urlopen.call_args.args[0]
        self.assertEqual(json.loads(request.data)["stream"], False)
        self.assertEqual(request.get_header("Accept"), "application/json")

    def test_anthropic_http_error_diagnostic_includes_status_and_body(self):
        error = urllib.error.HTTPError(
            "https://ai.starimg.ru/v1/messages",
            429,
            "Too Many Requests",
            {"content-type": "application/json", "x-request-id": "req-limit-429"},
            io.BytesIO(b'{"error":{"type":"rate_limit_error","message":"rate limit"}}'),
        )
        with patch("worker.urllib.request.urlopen", side_effect=error):
            with self.assertRaises(RuntimeError) as raised:
                starimg_anthropic_stream_completion(
                    "https://ai.starimg.ru/v1",
                    "test-key",
                    {"model": "claude-fable-5-2", "messages": []},
                )

        message = str(raised.exception)
        self.assertIn("HTTP 429", message)
        self.assertIn("req-limit-429", message)
        self.assertIn("rate limit", message)

    def test_single_file_extractor_accepts_apply_patch_add_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            answer = (
                "*** Begin Patch\n"
                "*** Add File: src/roster.rs\n"
                "+pub fn roster() -> usize { 23 }\n"
                "*** End Patch"
            )
            patch = extract_single_file_patch(answer, "src/roster.rs", root)
            self.assertIn("new file mode 100644", patch)
            self.assertIn("+pub fn roster() -> usize { 23 }", patch)

    def test_single_file_extractor_accepts_apply_patch_update_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / "src" / "lib.rs"
            target.parent.mkdir(parents=True)
            target.write_text("pub mod api;\npub mod state;\n", encoding="utf-8")
            answer = (
                "*** Begin Patch\n"
                "*** Update File: src/lib.rs\n"
                "@@\n"
                " pub mod api;\n"
                "+pub mod roster;\n"
                " pub mod state;\n"
                "*** End Patch"
            )
            patch = extract_single_file_patch(answer, "src/lib.rs", root)
            self.assertIn("+pub mod roster;", patch)

    def test_single_file_extractor_builds_patch_from_complete_new_file_code_block(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            answer = "Here is the file:\n```rust\npub fn roster() -> usize { 23 }\n```"
            patch = extract_single_file_patch(answer, "services/football-dynasty/src/roster.rs", root)
            self.assertIn("new file mode 100644", patch)
            self.assertIn("+pub fn roster() -> usize { 23 }", patch)

    def test_single_file_extractor_builds_patch_from_complete_existing_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / "src" / "lib.rs"
            target.parent.mkdir(parents=True)
            target.write_text("pub mod api;\npub mod state;\n", encoding="utf-8")
            answer = "Updated file:\n```rust\npub mod api;\npub mod roster;\npub mod state;\n```"
            patch = extract_single_file_patch(answer, "src/lib.rs", root)
            self.assertIn("+pub mod roster;", patch)

    def test_extract_patch_accepts_exact_single_file_scope(self):
        patch = (
            "diff --git a/services/football-dynasty/src/lib.rs b/services/football-dynasty/src/lib.rs\n"
            "--- a/services/football-dynasty/src/lib.rs\n"
            "+++ b/services/football-dynasty/src/lib.rs\n"
            "@@ -1 +1,2 @@\n pub mod api;\n+pub mod roster;\n"
        )
        extracted = extract_patch(patch, ("services/football-dynasty/src/lib.rs",))
        self.assertIn("+pub mod roster;", extracted)

    def test_extract_patch_rejects_a_second_required_file_in_single_file_scope(self):
        patch = (
            "diff --git a/docs/MAP.md b/docs/MAP.md\n"
            "--- a/docs/MAP.md\n+++ b/docs/MAP.md\n"
            "@@ -1 +1 @@\n-old\n+new\n"
        )
        with self.assertRaises(RuntimeError):
            extract_patch(patch, ("services/football-dynasty/src/lib.rs",))

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
        self.assertNotIn("temperature", payload)
        self.assertNotIn("top_p", payload)
        self.assertNotIn("top_k", payload)
        self.assertIn("system", payload)
        self.assertEqual(payload["messages"][0]["role"], "user")
        self.assertTrue(completion.call_args.args[0].endswith("/v1"))

    def test_fable_52_request_omits_sampling_parameters(self):
        from worker import ask_starimg

        with patch("worker.starimg_anthropic_stream_completion", return_value={
            "choices": [{"message": {"content": "diff --git a/src/a.ts b/src/a.ts\\n"}}],
            "usage": {},
        }) as completion:
            ask_starimg(
                "https://ai.starimg.ru/v1", "test-key", "claude-fable-5-2",
                "Implement task", 394, "repo context", ("src/",),
            )
        payload = completion.call_args.args[2]
        self.assertEqual(payload["model"], "claude-fable-5-2")
        self.assertNotIn("temperature", payload)
        self.assertNotIn("top_p", payload)
        self.assertNotIn("top_k", payload)
        self.assertEqual(payload["stream"], False)
        self.assertEqual(payload["thinking"], {"type": "adaptive", "display": "summarized"})
        self.assertEqual(payload["output_config"], {"effort": "medium"})

    def test_single_file_prompt_requests_complete_content_for_new_target(self):
        from worker import ask_starimg

        with patch("worker.starimg_anthropic_stream_completion", return_value={
            "choices": [{"message": {"content": "```rust\\npub mod roster;\\n```"}}],
            "usage": {"input_tokens": 10, "output_tokens": 5},
        }) as completion:
            ask_starimg(
                "https://ai.starimg.ru/v1",
                "test-key",
                "claude-fable-5-2",
                "IMPLEMENTATION UNIT: modify exactly this one required path: "
                "services/football-dynasty/src/roster.rs",
                394,
                "--- REQUIRED NEW FILE (does not exist yet): services/football-dynasty/src/roster.rs ---",
                ("services/football-dynasty/src/roster.rs",),
            )

        payload = completion.call_args.args[2]
        self.assertIn("complete file contents", payload["system"])
        self.assertIn("one fenced code block", payload["system"])
        self.assertIn("complete file contents", payload["messages"][0]["content"])
        self.assertNotIn("unified git diff only", payload["messages"][0]["content"])

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


    def test_rust_changes_run_stable_edition_2024_rustfmt_check(self):
        from worker import Worker

        worker = Worker.__new__(Worker)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = root / "services" / "football-dynasty" / "Cargo.toml"
            manifest.parent.mkdir(parents=True)
            manifest.write_text('[package]\\nname = "fixture"\\nedition = "2024"\\n', encoding="utf-8")
            with patch("worker.run_command") as command:
                worker._validate(
                    root,
                    ["services/football-dynasty/src/roster.rs", "docs/MAP.md"],
                )
            calls = command.call_args_list
            self.assertEqual(len(calls), 2)
            self.assertEqual(calls[0].args[0], [
                "rustfmt", "--edition", "2024", "services/football-dynasty/src/roster.rs"
            ])
            self.assertEqual(calls[1].args[0], [
                "rustfmt", "--check", "--edition", "2024", "services/football-dynasty/src/roster.rs"
            ])
            self.assertTrue(all(call.kwargs["timeout"] == 300 for call in calls))

    def test_full_rust_validation_uses_compile_only_without_test_database_url(self):
        from worker import Worker

        worker = Worker.__new__(Worker)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = root / "services" / "football-dynasty" / "Cargo.toml"
            manifest.parent.mkdir(parents=True)
            manifest.write_text('[package]\\nname = "fixture"\\nedition = "2024"\\n', encoding="utf-8")
            with patch.dict(os.environ, {}, clear=True), patch("worker.run_command") as command:
                worker._validate(
                    root,
                    ["services/football-dynasty/migrations/0005_squad_contracts.sql"],
                    full=True,
                )

        calls = command.call_args_list
        self.assertEqual(len(calls), 3)
        self.assertEqual(calls[0].args[0], [
            "cargo", "fmt", "--manifest-path", "services/football-dynasty/Cargo.toml", "--", "--check"
        ])
        self.assertEqual(calls[1].args[0], [
            "cargo", "clippy", "--manifest-path", "services/football-dynasty/Cargo.toml",
            "--all-targets", "--", "-D", "warnings"
        ])
        self.assertEqual(calls[1].kwargs["extra_env"], {"DATABASE_URL": "postgresql://localhost:5432/sherlock_test"})
        self.assertEqual(calls[2].args[0], [
            "cargo", "test", "--manifest-path", "services/football-dynasty/Cargo.toml",
            "--all-targets", "--no-run"
        ])
        self.assertEqual(calls[2].kwargs["extra_env"], {"DATABASE_URL": "postgresql://localhost:5432/sherlock_test"})

    def test_full_rust_validation_runs_cargo_checks_with_only_disposable_database_url(self):
        from worker import Worker

        worker = Worker.__new__(Worker)
        test_database_url = "postgresql://test-user:test-password@ep-test.example/neondb?sslmode=require"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = root / "services" / "football-dynasty" / "Cargo.toml"
            manifest.parent.mkdir(parents=True)
            manifest.write_text('[package]\\nname = "fixture"\\nedition = "2024"\\n', encoding="utf-8")
            with patch.dict(os.environ, {
                "TEST_DATABASE_URL": test_database_url,
                "SUPABASE_DB_URL": "postgresql://production-secret",
            }, clear=True), patch("worker.run_command") as command:
                worker._validate(
                    root,
                    ["services/football-dynasty/migrations/0005_squad_contracts.sql", "docs/MAP.md"],
                    full=True,
                )

        calls = command.call_args_list
        self.assertEqual(len(calls), 3)
        self.assertEqual(calls[0].args[0], [
            "cargo", "fmt", "--manifest-path", "services/football-dynasty/Cargo.toml", "--", "--check"
        ])
        self.assertEqual(calls[1].args[0], [
            "cargo", "clippy", "--manifest-path", "services/football-dynasty/Cargo.toml",
            "--all-targets", "--", "-D", "warnings"
        ])
        self.assertEqual(calls[2].args[0], [
            "cargo", "test", "--manifest-path", "services/football-dynasty/Cargo.toml", "--all-targets"
        ])
        self.assertEqual(calls[2].kwargs["extra_env"], {"DATABASE_URL": test_database_url})
        self.assertTrue(all("SUPABASE_DB_URL" not in call.kwargs.get("extra_env", {}) for call in calls))

    def test_rust_validation_fails_closed_without_manifest(self):
        from worker import Worker

        worker = Worker.__new__(Worker)
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(RuntimeError, "Cargo.toml is missing"):
                worker._validate(
                    Path(directory),
                    ["services/football-dynasty/src/roster.rs"],
                )



    def test_extract_agent_json_parses_fenced_object(self):
        from worker import extract_agent_json

        fence = chr(96) * 3
        value = extract_agent_json(fence + 'json\n{"verdict":"approve","findings":[]}\n' + fence)
        self.assertEqual(value["verdict"], "approve")
        self.assertEqual(value["findings"], [])

    def test_extract_agent_json_rejects_non_object(self):
        from worker import extract_agent_json

        with self.assertRaises(RuntimeError):
            extract_agent_json("No structured handoff")

    def test_fable_architect_agent_uses_anthropic_json_mode(self):
        from worker import ask_starimg_agent

        payload_text = '{"goal":"complete task","steps":["inspect","implement"],"risks":[],"acceptance_checks":["tests"]}'
        with patch("worker.starimg_anthropic_stream_completion", return_value={
            "choices": [{"message": {"content": payload_text}}],
            "usage": {"input_tokens": 12, "output_tokens": 20},
        }) as completion:
            answer, usage = ask_starimg_agent(
                "https://ai.starimg.ru/v1", "test-key", "claude-fable-5-2",
                "architect", "Implement task", 394, "repository context",
            )
        self.assertEqual(answer, payload_text)
        self.assertEqual(usage["output_tokens"], 20)
        payload = completion.call_args.args[2]
        self.assertEqual(payload["model"], "claude-fable-5-2")
        self.assertEqual(payload["stream"], False)
        self.assertEqual(payload["thinking"], {"type": "adaptive", "display": "summarized"})
        self.assertEqual(payload["output_config"], {"effort": "medium"})
        self.assertNotIn("temperature", payload)

    def test_full_file_fallback_strips_outer_fence_and_writes_only_safe_target(self):
        from worker import write_full_file_content

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_full_file_content(
                root,
                "services/football-dynasty/src/roster.rs",
                "```rust\npub struct Roster { pub players: Vec<String> }\n```",
            )
            written = (root / "services/football-dynasty/src/roster.rs").read_text()
            self.assertEqual(written, "pub struct Roster { pub players: Vec<String> }\n")
            with self.assertRaisesRegex(RuntimeError, "restricted path"):
                write_full_file_content(root, "../../secrets.env", "secret=bad")

    def test_full_file_fallback_rejects_diff_instead_of_file_content(self):
        with self.assertRaisesRegex(RuntimeError, "complete file content"):
            extract_full_file_content("diff --git a/a b/a\n@@ -1 +1 @@\n-old\n+new", "a")

    def test_github_actions_check_summary_waits_for_all_jobs_and_ignores_vercel(self):
        success = github_actions_check_summary([
            {"name": "python-tests", "status": "completed", "conclusion": "success",
             "app": {"slug": "github-actions", "name": "GitHub Actions"}},
            {"name": "Vercel", "status": "completed", "conclusion": "failure",
             "app": {"slug": "vercel", "name": "Vercel"}},
        ])
        self.assertEqual(success["state"], "success")
        pending = github_actions_check_summary([
            {"name": "rust-tests", "status": "in_progress", "app": {"slug": "github-actions"}}
        ])
        self.assertEqual(pending["state"], "pending")
        failed = github_actions_check_summary([
            {"name": "rust-tests", "status": "completed", "conclusion": "failure",
             "app": {"slug": "github-actions"}}
        ])
        self.assertEqual(failed["state"], "failure")

    def test_reviewable_pr_requires_autonomous_branch_and_marker(self):
        from worker import is_reviewable_pr

        pr = {
            "draft": True,
            "body": "Automated task <!-- sherlock-agent-task:123 -->",
            "head": {"ref": "ai/task-394-123"},
        }
        self.assertTrue(is_reviewable_pr(pr))
        pr["head"]["ref"] = "feature/manual-change"
        self.assertFalse(is_reviewable_pr(pr))
        pr["head"]["ref"] = "ai/task-394-123"
        pr["body"] = "ordinary PR"
        self.assertFalse(is_reviewable_pr(pr))

    def test_runtime_control_plane_pr_is_reviewable_only_with_marker(self):
        from worker import is_reviewable_pr, reviewer_issue_number

        pr = {
            "number": 406,
            "draft": True,
            "body": "Runtime control plane <!-- sherlock-agent-runtime-review:20261113 -->",
            "head": {"ref": "feat/sherlock-multi-agent-runtime-20261113"},
        }
        self.assertTrue(is_reviewable_pr(pr))
        self.assertEqual(reviewer_issue_number(pr), 406)
        pr["body"] = "Runtime control plane"
        self.assertFalse(is_reviewable_pr(pr))
        pr["body"] = "Runtime control plane <!-- sherlock-agent-runtime-review:20261113 -->"
        pr["draft"] = True
        self.assertTrue(is_reviewable_pr(pr))


    def test_review_marker_is_scoped_to_exact_head_sha(self):
        from worker import has_review_marker

        comments = [{"body": "Reviewed <!-- sherlock-agent-review:abc123 -->"}]
        self.assertTrue(has_review_marker(comments, "abc123"))
        self.assertFalse(has_review_marker(comments, "def456"))

    def test_railway_preflight_falls_back_to_workspace_token(self):
        from worker import integration_preflight

        calls = []

        def fake_provider_request(url, token, method="GET", payload=None,
                                  token_header="Authorization", timeout=20):
            if "railway.com" in url:
                query = (payload or {}).get("query", "")
                calls.append((query, token_header))
                if "me {" in query:
                    return {"errors": [{"message": "not authorized"}]}
                if "workspace(" in query:
                    return {"data": {"workspace": {"id": "workspace-id", "name": "workspace"}}}
                raise AssertionError("Unexpected Railway query")
            raise AssertionError(f"Unexpected provider URL: {url}")

        with patch.dict(os.environ, {
            "RAILWAY": "railway-secret",
            "RAILWAY_WORKSPACE_ID": "workspace-id",
        }, clear=True), patch("worker.provider_request_json", side_effect=fake_provider_request):
            result = integration_preflight()

        self.assertEqual(result["railway_api"], {"status": "connected", "scope": "workspace"})
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0][1], "Authorization")
        self.assertEqual(calls[1][1], "Authorization")

    def test_cloudflare_preflight_rejects_inactive_tokens(self):
        from worker import cloudflare_token_probe

        with patch("worker.provider_request_json", return_value={
            "success": True, "result": {"status": "disabled"}
        }):
            with self.assertRaisesRegex(RuntimeError, "disabled"):
                cloudflare_token_probe("test-token")


    def test_integration_preflight_reports_unconfigured_services_without_secrets(self):
        from worker import integration_preflight

        with patch.dict(os.environ, {}, clear=True):
            result = integration_preflight()
        for provider in ("cloudflare", "fly", "neon", "railway_api", "render", "supabase", "vercel"):
            self.assertEqual(result[provider]["status"], "not_configured", provider)

    def test_integration_preflight_checks_configured_providers_without_returning_tokens(self):
        from worker import integration_preflight

        secrets = {
            "CLOUDFLARE_API_TOKEN": "cloudflare-secret",
            "FLY_API_TOKEN": "fly-secret",
            "NEON_API_KEY": "neon-secret",
            "RAILWAY": "railway-secret",
            "RENDER_API_KEY": "render-secret",
            "SUPABASE_ACCESS_TOKEN": "supabase-secret",
            "SUPABASE_PROJECT_REF": "test-project",
            "VERCEL_TOKEN": "vercel-secret",
            "VERCEL_PROJECT_ID": "project-id",
            "VERCEL_TEAM_ID": "team-id",
        }

        def fake_provider_request(url, token, method="GET", payload=None,
                                  token_header="Authorization", timeout=20):
            if "cloudflare" in url:
                return {"success": True, "result": {"status": "active"}}
            if "machines.dev" in url:
                return {"total_apps": 2}
            if "neon.tech" in url:
                return {"projects": [{}, {}]}
            if "render.com" in url:
                return [{}, {}]
            if "railway.com" in url:
                return {"data": {"me": {"name": "workspace"}}}
            if "supabase.com" in url:
                return {"status": "ACTIVE", "region": "eu-central-1", "database_version": "16"}
            if "/v9/projects/" in url:
                return {"name": "sherlock"}
            if "/v6/deployments" in url:
                return {"deployments": [{"readyState": "READY", "meta": {"githubCommitSha": "abc"}}]}
            raise AssertionError(f"Unexpected provider URL: {url}")

        with patch.dict(os.environ, secrets, clear=True), \
             patch("worker.provider_request_json", side_effect=fake_provider_request):
            result = integration_preflight()

        for provider in ("cloudflare", "fly", "neon", "railway_api", "render", "supabase", "vercel"):
            self.assertEqual(result[provider]["status"], "connected", provider)
        rendered = json.dumps(result)
        for secret in secrets.values():
            self.assertNotIn(secret, rendered)



    def test_blocking_findings_accepts_only_declared_severities(self):
        from worker import blocking_findings

        findings = [
            {"severity": "minor", "problem": "style"},
            {"severity": "major", "problem": "missing guard"},
            {"severity": "blocker", "problem": "unsafe write"},
        ]
        self.assertEqual(len(blocking_findings(findings)), 2)

    def test_blocking_findings_rejects_unknown_severity_fail_closed(self):
        from worker import blocking_findings

        with self.assertRaisesRegex(RuntimeError, "unsupported severity"):
            blocking_findings([{"severity": "critical", "problem": "unknown level"}])



    def test_architect_handoff_requires_all_contract_fields(self):
        from worker import validate_architect_plan

        valid = {
            "goal": "complete task",
            "steps": ["inspect", "implement"],
            "risks": [],
            "acceptance_checks": ["tests"],
        }
        self.assertEqual(validate_architect_plan(valid), valid)
        with self.assertRaisesRegex(RuntimeError, "acceptance_checks"):
            validate_architect_plan({"goal": "x", "steps": [], "risks": []})

    def test_recovered_task_branch_creates_pr_without_unbound_handoffs(self):
        from worker import Worker

        worker = object.__new__(Worker)
        worker.attempted = set()
        worker.owner = "Aloews"
        worker.repo = "Aloews/sherlock-scholes-"
        worker.token = "test-token"
        worker.default_branch = "main"
        comment = {
            "id": 12345,
            "body": "/ai finish task",
            "user": {"login": "Aloews"},
            "issue_url": "https://api.github.com/repos/Aloews/sherlock-scholes-/issues/77",
            "html_url": "https://github.com/Aloews/sherlock-scholes-/issues/77#issuecomment-12345",
        }
        with patch("worker.request_json", return_value={"title": "test", "body": "task"}), \
             patch.object(Worker, "_existing_pr", return_value=None), \
             patch.object(Worker, "_branch_exists", return_value=True), \
             patch.object(Worker, "_create_pr", return_value={
                 "number": 88, "html_url": "https://github.com/Aloews/sherlock-scholes-/pull/88",
                 "head": {"sha": "abc123"},
             }) as create_pr, \
             patch.object(Worker, "_wait_for_github_actions", return_value={"state": "success", "checks": []}), \
             patch.object(Worker, "_post_task_result"):
            worker.process(comment)

        self.assertEqual(worker.attempted, {12345})
        self.assertEqual(create_pr.call_args.args[:4], (
            77, 12345, "ai/task-77-12345",
            "https://github.com/Aloews/sherlock-scholes-/issues/77#issuecomment-12345",
        ))
        self.assertIn("Recovered an existing isolated task branch", create_pr.call_args.args[4])
        self.assertEqual(create_pr.call_args.args[5]["verdict"], "not_run")


    def test_reviewer_handoff_requires_summary_and_findings(self):
        from worker import validate_reviewer_output

        self.assertEqual(
            validate_reviewer_output({"summary": "Reviewed", "findings": []}),
            [],
        )
        with self.assertRaisesRegex(RuntimeError, "summary"):
            validate_reviewer_output({"findings": []})
        with self.assertRaisesRegex(RuntimeError, "JSON array"):
            validate_reviewer_output({"summary": "Reviewed"})


if __name__ == "__main__":
    unittest.main()
