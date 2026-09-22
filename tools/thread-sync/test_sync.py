import json
import io
import tempfile
import unittest
import urllib.error
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import codex_task_sync as sync
import render_board


NOW = datetime(2026, 9, 8, tzinfo=timezone.utc)


def task(task_id, updated_at, device, status="active", confidence="low", account="账号1"):
    thread_id = task_id.rsplit(":", 1)[1]
    _, account_key = sync.normalize_account_alias(account)
    return {
        "task_id": task_id,
        "thread_id": thread_id,
        "account_alias": account,
        "account_key": account_key,
        "title": "Synthetic task",
        "status": status,
        "status_confidence": confidence,
        "status_basis": ["test"],
        "attention_score": 10,
        "recommended_action": "review_or_continue",
        "created_at": updated_at,
        "updated_at": updated_at,
        "archived": False,
        "pinned": False,
        "source_kind": "user",
        "device_ids": [device],
        "locator": {"type": "codex_thread", "thread_id": thread_id},
    }


def snapshot(device, tasks, account="账号1"):
    account_alias, account_key = sync.normalize_account_alias(account)
    return {
        "schema_version": 1,
        "kind": "codex_task_snapshot",
        "generated_at": "2026-09-08T00:00:00Z",
        "device": {"id": device},
        "account": {"alias": account_alias, "key": account_key},
        "tasks": tasks,
    }


class ClassificationTests(unittest.TestCase):
    def classify(self, title="ordinary", archived=False, pinned=False, goal=None, day=8):
        updated = datetime(2026, 9, day, tzinfo=timezone.utc)
        return sync.classify_task(title, archived, pinned, goal, updated, NOW, 7)

    def test_goal_blocked_has_highest_attention(self):
        status, confidence, basis, score, _ = self.classify(archived=True, goal="blocked")
        self.assertEqual(status, "needs_attention")
        self.assertEqual(confidence, "high")
        self.assertEqual(score, 100)
        self.assertEqual(basis, ["explicit_goal_blocked"])

    def test_archive_is_not_claimed_as_completed(self):
        status, confidence, *_ = self.classify(archived=True)
        self.assertEqual(status, "archived")
        self.assertEqual(confidence, "high")

    def test_stale_thread_is_suggested(self):
        status, confidence, *_ = self.classify(day=1)
        self.assertEqual(status, "suggested_next")
        self.assertEqual(confidence, "low")

    def test_chinese_title_markers(self):
        self.assertEqual(self.classify(title="【已完成】同步器")[0], "completed")
        self.assertEqual(self.classify(title="【等我确认】同步器")[0], "needs_attention")
        self.assertEqual(self.classify(title="【进行中】同步器")[0], "in_progress")


class MergeTests(unittest.TestCase):
    def test_newest_observation_wins_and_devices_are_unioned(self):
        old = task("codex:abc", "2026-09-01T00:00:00Z", "laptop", "active")
        new = task("codex:abc", "2026-09-08T00:00:00Z", "desktop", "needs_attention", "high")
        merged = sync.merge_snapshots([snapshot("laptop", [old]), snapshot("desktop", [new])], now=NOW)
        self.assertEqual(len(merged["tasks"]), 1)
        result = merged["tasks"][0]
        self.assertEqual(result["status"], "needs_attention")
        self.assertEqual(result["device_ids"], ["desktop", "laptop"])
        self.assertEqual(result["sync"]["observation_count"], 2)

    def test_rejects_invalid_snapshot(self):
        with self.assertRaises(sync.SyncError):
            sync.merge_snapshots([{"schema_version": 9, "tasks": []}], now=NOW)

    def test_same_thread_id_in_two_accounts_stays_separate(self):
        _, account_one_key = sync.normalize_account_alias("账号1")
        _, account_two_key = sync.normalize_account_alias("账号2")
        one = task(f"codex:{account_one_key}:same-thread", "2026-09-08T00:00:00Z", "desktop", account="账号1")
        two = task(f"codex:{account_two_key}:same-thread", "2026-09-08T00:00:00Z", "laptop", account="账号2")
        merged = sync.merge_snapshots([
            snapshot("desktop", [one], "账号1"),
            snapshot("laptop", [two], "账号2"),
        ], now=NOW)
        self.assertEqual(len(merged["tasks"]), 2)
        self.assertEqual({item["alias"] for item in merged["accounts"]}, {"账号1", "账号2"})

    def test_legacy_and_account_aware_snapshot_do_not_duplicate(self):
        _, account_key = sync.normalize_account_alias("账号1")
        legacy = task("codex:same-thread", "2026-09-01T00:00:00Z", "desktop")
        current = task(f"codex:{account_key}:same-thread", "2026-09-08T00:00:00Z", "desktop")
        merged = sync.merge_snapshots([
            snapshot("desktop", [legacy]),
            snapshot("desktop", [current], "账号1"),
        ], now=NOW)
        self.assertEqual(len(merged["tasks"]), 1)
        self.assertEqual(merged["tasks"][0]["task_id"], f"codex:{account_key}:same-thread")


class SafetyTests(unittest.TestCase):
    def test_analysis_context_keeps_turns_but_redacts_sensitive_content(self):
        records = [
            {
                "type": "response_item",
                "payload": {
                    "type": "message",
                    "role": "user",
                    "content": [{"type": "input_text", "text": "请检查 C:\\\\private\\\\repo，key=" + "sk-" + "example1234567890"}],
                },
            },
            {
                "type": "response_item",
                "payload": {
                    "type": "message",
                    "role": "assistant",
                    "content": [{"type": "output_text", "text": "测试完成，```python\\nprint('secret')\\n```请确认发布。"}],
                },
            },
            {
                "type": "response_item",
                "payload": {"type": "custom_tool_call_output", "output": "工具输出不应上传"},
            },
        ]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "session.jsonl"
            path.write_text("\n".join(json.dumps(item, ensure_ascii=False) for item in records), encoding="utf-8")
            context = sync.extract_analysis_context(path)

        self.assertIsNotNone(context)
        serialized = json.dumps(context["turns"], ensure_ascii=False)
        self.assertEqual(len(context["turns"]), 2)
        self.assertNotIn("sk-example", serialized)
        self.assertNotIn("private", serialized)
        self.assertNotIn("print", serialized)
        self.assertNotIn("工具输出", serialized)
        self.assertIn("请确认发布", serialized)

    def test_output_inside_codex_home_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory) / ".codex"
            home.mkdir()
            with self.assertRaises(sync.SyncError):
                sync.safe_output_path(str(home / "snapshot.json"), home)

    def test_snapshot_json_round_trip(self):
        value = snapshot("laptop", [task("codex:abc", "2026-09-08T00:00:00Z", "laptop")])
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "snapshot.json"
            path.write_text(json.dumps(value), encoding="utf-8")
            loaded = sync.read_json(path)
        self.assertEqual(loaded["device"]["id"], "laptop")

    def test_directory_input_expands_json_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "one.json").write_text("{}", encoding="utf-8")
            (root / "ignore.txt").write_text("x", encoding="utf-8")
            result = sync.expand_input_paths([root])
        self.assertEqual([path.name for path in result], ["one.json"])

    def test_offline_dashboard_escapes_embedded_markup(self):
        value = snapshot("laptop", [task("codex:abc", "2026-09-08T00:00:00Z", "laptop")])
        value["tasks"][0]["title"] = "</script><script>alert(1)</script>"
        output = render_board.render_dashboard(value)
        self.assertIn("Threadline · 本地任务板", output)
        self.assertNotIn("</script><script>alert(1)</script>", output)


class CloudSyncTests(unittest.TestCase):
    class SuccessResponse:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self):
            return b'{"ok":true,"accepted":1,"syncedAt":"2026-09-08T00:00:00Z"}'

    def pairing(self):
        return {
            "version": 1,
            "site_url": "https://threadline.example/",
            "upload_path": "/api/device-sync",
            "sites_authorization": "site-secret",
            "device_token": "device-secret",
            "device_id": "device-1",
            "account_alias": "账号2",
        }

    def test_pairing_requires_https(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "device.json"
            value = self.pairing()
            value["site_url"] = "http://threadline.example"
            path.write_text(json.dumps(value), encoding="utf-8")
            with self.assertRaises(sync.SyncError):
                sync.read_pairing_config(path)

    def test_pairing_accepts_windows_powershell_utf8_bom(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "device.json"
            path.write_text(json.dumps(self.pairing()), encoding="utf-8-sig")
            loaded = sync.read_pairing_config(path)

        self.assertEqual(loaded["device_id"], "device-1")
        self.assertEqual(loaded["account_alias"], "账号2")

    def test_upload_uses_both_credentials_and_metadata_only_payload(self):
        value = snapshot(
            "device-1",
            [task("codex:abc", "2026-09-08T00:00:00Z", "device-1", account="账号2")],
            "账号2",
        )
        with patch.object(sync.urllib.request, "urlopen", return_value=self.SuccessResponse()) as opener:
            result = sync.upload_snapshot(self.pairing(), value)

        request = opener.call_args.args[0]
        headers = {key.lower(): item for key, item in request.header_items()}
        body = json.loads(request.data.decode("utf-8"))
        self.assertTrue(result["ok"])
        self.assertEqual(headers["oai-sites-authorization"], "site-secret")
        self.assertEqual(headers["x-threadline-device-token"], "device-secret")
        self.assertEqual(body["snapshot"]["device"]["id"], "device-1")
        self.assertNotIn("messages", request.data.decode("utf-8"))

    def test_upload_retries_sites_token_as_bearer(self):
        value = snapshot("device-1", [], "账号2")
        first = urllib.error.HTTPError(
            "https://threadline.example/api/device-sync", 401, "Unauthorized", {}, io.BytesIO()
        )
        with patch.object(
            sync.urllib.request,
            "urlopen",
            side_effect=[first, self.SuccessResponse()],
        ) as opener:
            sync.upload_snapshot(self.pairing(), value)

        second_request = opener.call_args_list[1].args[0]
        headers = {key.lower(): item for key, item in second_request.header_items()}
        self.assertEqual(headers["oai-sites-authorization"], "Bearer site-secret")


if __name__ == "__main__":
    unittest.main()
