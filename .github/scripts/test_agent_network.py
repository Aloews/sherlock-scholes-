import io
import json
import os
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

import agent_network

class AgentNetworkTests(unittest.TestCase):
    def test_issue_body_is_included_in_agent_task(self):
        task = agent_network.build_issue_task(
            {"number": 392, "title": "Squad UI", "body": "Required paths: roster.rs and screen.tsx"},
            "Implement the issue exactly",
        )
        self.assertIn("Required paths: roster.rs and screen.tsx", task)
        self.assertIn("Owner request:\nImplement the issue exactly", task)

    def test_required_issue_files_are_parsed_and_enforced(self):
        body = """## Required files — all eight must be present in the same PR
- `services/football-dynasty/migrations/0008_squad_contracts.sql`
- `services/football-dynasty/src/roster.rs`
- `services/football-dynasty/src/lib.rs`
- `services/football-dynasty/src/http.rs`
- `services/football-dynasty/tests/campaign_lifecycle.rs`
- `src/features/football-dynasty/api.ts`
- `src/screens/FootballDynastyScreen.tsx`
- `docs/MAP.md`"""
        required = agent_network.required_paths_from_issue(body)
        self.assertEqual(len(required), 8)
        self.assertEqual(
            agent_network.missing_required_paths(required, required[:7]),
            sorted(required[7:]),
        )

    def test_parse_role_json(self):
        self.assertEqual(agent_network.parse_object('{"decision":"approve"}'), {"decision": "approve"})
        fence = chr(96) * 3
        self.assertEqual(agent_network.parse_object(fence + 'json\n{"decision":"approve"}\n' + fence), {"decision": "approve"})

    def test_rejects_non_object_json(self):
        with self.assertRaises(ValueError):
            agent_network.parse_object('["not", "an", "object"]')

    def test_normalizes_qwen_edits_and_fable_changes(self):
        qwen = {"edits": [{"path": "src/a.py", "old": "a", "new": "b"}]}
        fable = {"changes": [{"operation": "replace", "path": "src/a.py", "old": "a", "new": "b"}]}
        self.assertEqual(agent_network.normalize_role_edits(qwen), [{"path": "src/a.py", "old": "a", "new": "b"}])
        self.assertEqual(agent_network.normalize_role_edits(fable), [{"path": "src/a.py", "old": "a", "new": "b"}])

    def test_escalation_flag_is_strict(self):
        self.assertTrue(agent_network.wants_fable(True))
        self.assertTrue(agent_network.wants_fable("true"))
        self.assertFalse(agent_network.wants_fable(False))
        self.assertFalse(agent_network.wants_fable("false"))
        self.assertFalse(agent_network.wants_fable(None))

    def test_rejects_symlink_parent_escape(self):
        with tempfile.TemporaryDirectory() as temp, tempfile.TemporaryDirectory() as outside:
            root = Path(temp)
            (root / "src").mkdir()
            (root / "src/link").symlink_to(Path(outside), target_is_directory=True)
            with patch.object(agent_network, "ROOT", root):
                with self.assertRaises(ValueError):
                    agent_network.validate_edit_paths([{"path": "src/link/escape.py"}], set())

    def test_fable_budget_allows_only_one_paid_call_per_run(self):
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, {"RUNNER_TEMP": temp}):
            self.assertEqual(agent_network.reserve_fable_call("high-risk"), 1)
            with self.assertRaises(agent_network.EscalationError):
                agent_network.reserve_fable_call("ci-repair")

    def test_fable_usage_is_recorded_without_prompt_or_completion(self):
        with tempfile.TemporaryDirectory() as temp:
            summary = Path(temp) / "summary.md"
            env = {
                "RUNNER_TEMP": temp,
                "GITHUB_STEP_SUMMARY": str(summary),
                "GITHUB_RUN_ID": "12345",
                "GITHUB_REPOSITORY": "Aloews/sherlock-scholes-",
            }
            with patch.dict(os.environ, env):
                record = agent_network.record_fable_usage(
                    "ci-repair", 2600, "success",
                    {"input_tokens": 120, "output_tokens": 40,
                     "cache_read_input_tokens": 80, "cache_creation_input_tokens": 40},
                    request_id="req_123",
                )
            usage_file = Path(temp) / "starimg-usage.jsonl"
            saved = json.loads(usage_file.read_text(encoding="utf-8").splitlines()[0])
            self.assertEqual(saved["input_tokens"], 120)
            self.assertEqual(saved["output_tokens"], 40)
            self.assertEqual(saved["cache_read_input_tokens"], 80)
            self.assertEqual(saved["cache_creation_input_tokens"], 40)
            self.assertEqual(saved["provider_request_id"], "req_123")
            self.assertNotIn("prompt", saved)
            self.assertNotIn("completion", saved)
            self.assertIn("| Provider | Purpose | Status |", summary.read_text(encoding="utf-8"))
            self.assertEqual(record["max_output_tokens"], 2600)

    def test_fable_requires_configured_secret(self):
        with patch.dict(os.environ, {"STARIMG_API_KEY": ""}):
            with self.assertRaises(agent_network.EscalationError) as error:
                agent_network.fable_role("task", "context", "review blocker")
        self.assertIn("STARIMG_API_KEY is not configured", str(error.exception))

    def test_fable_402_is_not_retried_or_hidden(self):
        failure = urllib.error.HTTPError("https://ai.starimg.ru/v1/messages", 402, "Payment Required", {}, io.BytesIO(b"Payment Required"))
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, {"STARIMG_API_KEY": "test-only", "RUNNER_TEMP": temp}):
            with patch("agent_network.urllib.request.urlopen", side_effect=failure):
                with self.assertRaises(agent_network.EscalationError) as error:
                    agent_network.fable_role("task", "context", "review blocker")
        self.assertIn("HTTP 402", str(error.exception))
        self.assertIn("No automatic retry", str(error.exception))

    def test_fable_uses_anthropic_messages_contract(self):
        class Response:
            headers = {"request-id": "req_test"}
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self):
                return json.dumps({"content":[{"type":"text","text":'{"decision":"stop","diagnosis":"not enough evidence","changes":[]}'}]}).encode()
        captured = {}
        def fake_urlopen(request, timeout):
            captured["url"] = request.full_url
            captured["headers"] = request.headers
            captured["body"] = json.loads(request.data)
            return Response()
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, {"STARIMG_API_KEY":"test-only", "STARIMG_MODEL":"claude-fable-5-2", "RUNNER_TEMP":temp}):
            with patch("agent_network.urllib.request.urlopen", side_effect=fake_urlopen):
                result = agent_network.fable_role("task", "context", "reason")
        self.assertEqual(result["decision"], "stop")
        self.assertTrue(captured["url"].endswith("/v1/messages"))
        self.assertEqual(captured["body"]["model"], "claude-fable-5-2")
        self.assertIn("x-api-key", {key.lower() for key in captured["headers"]})

if __name__ == "__main__":
    unittest.main()
