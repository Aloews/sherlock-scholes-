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

    def test_rejects_symlink_parent_escape(self):
        with tempfile.TemporaryDirectory() as temp, tempfile.TemporaryDirectory() as outside:
            root = Path(temp)
            (root / "src").mkdir()
            (root / "src/link").symlink_to(Path(outside), target_is_directory=True)
            with patch.object(agent_network, "ROOT", root):
                with self.assertRaises(ValueError):
                    agent_network.validate_edit_paths([{"path": "src/link/escape.py"}], set())

    def test_fable_requires_configured_secret(self):
        with patch.dict(os.environ, {"STARIMG_API_KEY": ""}):
            with self.assertRaises(agent_network.EscalationError) as error:
                agent_network.fable_role("task", "context", "review blocker")
        self.assertIn("STARIMG_API_KEY is not configured", str(error.exception))

    def test_fable_402_is_not_retried_or_hidden(self):
        failure = urllib.error.HTTPError("https://ai.starimg.ru/v1/messages", 402, "Payment Required", {}, io.BytesIO(b"Payment Required"))
        with patch.dict(os.environ, {"STARIMG_API_KEY": "test-only"}):
            with patch("agent_network.urllib.request.urlopen", side_effect=failure):
                with self.assertRaises(agent_network.EscalationError) as error:
                    agent_network.fable_role("task", "context", "review blocker")
        self.assertIn("HTTP 402", str(error.exception))
        self.assertIn("No automatic retry", str(error.exception))

    def test_fable_uses_anthropic_messages_contract(self):
        class Response:
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
        with patch.dict(os.environ, {"STARIMG_API_KEY":"test-only", "STARIMG_MODEL":"claude-fable-5-2"}):
            with patch("agent_network.urllib.request.urlopen", side_effect=fake_urlopen):
                result = agent_network.fable_role("task", "context", "reason")
        self.assertEqual(result["decision"], "stop")
        self.assertTrue(captured["url"].endswith("/v1/messages"))
        self.assertEqual(captured["body"]["model"], "claude-fable-5-2")
        self.assertIn("x-api-key", {key.lower() for key in captured["headers"]})

if __name__ == "__main__":
    unittest.main()
