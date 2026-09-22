#!/usr/bin/env python3
"""Read-only Codex thread metadata exporter and Threadline cloud sync agent.

The scanner uses only Python's standard library and never writes into
CODEX_HOME. Network access is used only by the explicit sync command.
"""

from __future__ import annotations

import argparse
import glob
import hashlib
import json
import os
import platform
import re
import sqlite3
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from collections import Counter, deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


SCHEMA_VERSION = 1
AGENT_VERSION = "2.2.0"
ANALYSIS_CONTEXT_RECENT_LIMIT = 6
ANALYSIS_CONTEXT_ROTATING_LIMIT = 18
ANALYSIS_CONTEXT_ROTATION_SECONDS = 15 * 60
ANALYSIS_CONTEXT_MAX_BYTES = 512 * 1024
ANALYSIS_CONTEXT_MAX_TURNS = 4
ANALYSIS_CONTEXT_MAX_TEXT = 1600
UUID_RE = re.compile(
    r"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})",
    re.IGNORECASE,
)
COMPLETED_RE = re.compile(
    r"^\s*(?:✅|☑️|\[(?:done|completed)\]|【已完成】|已完成\s*[:：])",
    re.IGNORECASE,
)
ATTENTION_RE = re.compile(
    r"^\s*(?:⚠️|\[(?:blocked|waiting)\]|【(?:受阻|等我确认|待确认|待回复)】)",
    re.IGNORECASE,
)
IN_PROGRESS_RE = re.compile(
    r"^\s*(?:🚧|\[(?:wip|doing|in[- ]progress)\]|【进行中】)",
    re.IGNORECASE,
)
SUGGESTED_RE = re.compile(
    r"^\s*(?:📌|\[(?:todo|continue)\]|【(?:待继续|待办)】)",
    re.IGNORECASE,
)
CODE_BLOCK_RE = re.compile(r"```[\s\S]*?```", re.MULTILINE)
CONTEXT_BLOCK_RE = re.compile(
    r"<(?:environment_context|in-app-browser-context|heartbeat)\b[\s\S]*?</(?:environment_context|in-app-browser-context|heartbeat)>",
    re.IGNORECASE,
)
SECRET_RE = re.compile(
    r"(?i)(?:sk-[a-z0-9_-]{16,}|(?:api[_ -]?key|authorization|token|secret|password)\s*[:=]\s*[^\s,;]{8,})"
)
WINDOWS_PATH_RE = re.compile(r"(?i)\b[a-z]:\\(?:[^\s<>:\"|?*]+\\)*[^\s<>:\"|?*]*")
UNIX_HOME_RE = re.compile(r"/(?:home|Users)/[^\s]+")


class SyncError(RuntimeError):
    pass


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso_z(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def parse_time(value: Any, *, milliseconds: bool = False) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        number = float(value)
        if milliseconds or abs(number) >= 100_000_000_000:
            number /= 1000.0
        try:
            return datetime.fromtimestamp(number, tz=timezone.utc)
        except (OverflowError, OSError, ValueError):
            return None
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        if text.isdigit():
            return parse_time(int(text), milliseconds=milliseconds)
        try:
            return datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone(timezone.utc)
        except ValueError:
            return None
    return None


def newest_time(*values: datetime | None) -> datetime | None:
    present = [value for value in values if value is not None]
    return max(present) if present else None


def oldest_time(*values: datetime | None) -> datetime | None:
    present = [value for value in values if value is not None]
    return min(present) if present else None


def versioned_db(codex_home: Path, stem: str) -> Path | None:
    candidates = list(codex_home.glob(f"{stem}_*.sqlite"))
    plain = codex_home / f"{stem}.sqlite"
    if plain.is_file():
        candidates.append(plain)
    if not candidates:
        return None

    def sort_key(path: Path) -> tuple[int, int]:
        match = re.search(r"_(\d+)\.sqlite$", path.name)
        version = int(match.group(1)) if match else -1
        try:
            modified = path.stat().st_mtime_ns
        except OSError:
            modified = 0
        return version, modified

    return max(candidates, key=sort_key)


def connect_readonly(path: Path) -> sqlite3.Connection:
    # URI mode=ro prevents accidental DB creation and all SQL writes.
    uri = path.resolve().as_uri() + "?mode=ro"
    connection = sqlite3.connect(uri, uri=True, timeout=2.0)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA query_only = ON")
    connection.execute("PRAGMA busy_timeout = 2000")
    return connection


def table_columns(connection: sqlite3.Connection, table: str) -> set[str]:
    return {row["name"] for row in connection.execute(f'PRAGMA table_info("{table}")')}


def read_state_threads(path: Path | None) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    report: dict[str, Any] = {"available": False, "file": path.name if path else None}
    if path is None:
        return [], report
    wanted = [
        "id",
        "title",
        "name",
        "archived",
        "archived_at",
        "is_pinned",
        "created_at",
        "updated_at",
        "created_at_ms",
        "updated_at_ms",
        "recency_at",
        "recency_at_ms",
        "source",
        "thread_source",
    ]
    try:
        with connect_readonly(path) as connection:
            columns = table_columns(connection, "threads")
            selected = [column for column in wanted if column in columns]
            if "id" not in selected:
                raise SyncError(f"{path.name}: threads table has no id column")
            rows = [dict(row) for row in connection.execute(
                "SELECT " + ", ".join(f'\"{column}\"' for column in selected) + " FROM threads"
            )]
        report.update({"available": True, "rows": len(rows), "columns_used": selected})
        return rows, report
    except (sqlite3.Error, OSError, SyncError) as exc:
        report["error"] = f"{type(exc).__name__}: {exc}"
        return [], report


def read_goals(path: Path | None) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    report: dict[str, Any] = {"available": False, "file": path.name if path else None}
    if path is None:
        return {}, report
    try:
        with connect_readonly(path) as connection:
            columns = table_columns(connection, "thread_goals")
            wanted = [
                "thread_id",
                "status",
                "token_budget",
                "tokens_used",
                "time_used_seconds",
                "updated_at_ms",
            ]
            selected = [column for column in wanted if column in columns]
            if not {"thread_id", "status"}.issubset(selected):
                raise SyncError(f"{path.name}: unsupported thread_goals schema")
            rows = [dict(row) for row in connection.execute(
                "SELECT " + ", ".join(f'\"{column}\"' for column in selected) + " FROM thread_goals"
            )]
        goals: dict[str, dict[str, Any]] = {}
        for row in rows:
            thread_id = str(row.get("thread_id") or "")
            if not thread_id:
                continue
            current = goals.get(thread_id)
            current_time = int(current.get("updated_at_ms") or 0) if current else -1
            row_time = int(row.get("updated_at_ms") or 0)
            if current is None or row_time >= current_time:
                # Objective text is deliberately never queried or exported.
                goals[thread_id] = row
        report.update({
            "available": True,
            "rows": len(rows),
            "status_counts": dict(Counter(str(row.get("status") or "unknown") for row in rows)),
        })
        return goals, report
    except (sqlite3.Error, OSError, SyncError) as exc:
        report["error"] = f"{type(exc).__name__}: {exc}"
        return {}, report


def read_session_index(path: Path) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    report: dict[str, Any] = {"available": path.is_file(), "file": path.name}
    entries: dict[str, dict[str, Any]] = {}
    malformed = 0
    if not path.is_file():
        return entries, report
    try:
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                try:
                    value = json.loads(line)
                except json.JSONDecodeError:
                    malformed += 1
                    continue
                thread_id = str(value.get("id") or "")
                if thread_id:
                    entries[thread_id] = value
        report.update({"rows": len(entries), "malformed_rows": malformed})
    except OSError as exc:
        report["error"] = f"{type(exc).__name__}: {exc}"
    return entries, report


def session_meta(path: Path) -> dict[str, Any]:
    """Read only the first session_meta record; never retain message content."""
    try:
        with path.open("r", encoding="utf-8") as handle:
            for _ in range(8):
                line = handle.readline()
                if not line:
                    break
                try:
                    value = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if value.get("type") == "session_meta" and isinstance(value.get("payload"), dict):
                    payload = value["payload"]
                    allowed = {"id", "session_id", "timestamp", "source", "thread_source"}
                    return {key: payload.get(key) for key in allowed if key in payload}
    except OSError:
        pass
    return {}


def sanitize_analysis_text(value: str) -> tuple[str, int]:
    redactions = 0

    def replace(pattern: re.Pattern[str], text: str, replacement: str) -> str:
        nonlocal redactions
        text, count = pattern.subn(replacement, text)
        redactions += count
        return text

    text = replace(CONTEXT_BLOCK_RE, value, "[运行环境信息已省略]")
    text = replace(CODE_BLOCK_RE, text, "[代码块已省略]")
    text = replace(SECRET_RE, text, "[敏感凭据已删除]")
    text = replace(WINDOWS_PATH_RE, text, "[本地路径已省略]")
    text = replace(UNIX_HOME_RE, text, "[本地路径已省略]")
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) > ANALYSIS_CONTEXT_MAX_TEXT:
        text = text[: ANALYSIS_CONTEXT_MAX_TEXT - 1].rstrip() + "…"
    return text, redactions


def extract_analysis_context(path: Path | None) -> dict[str, Any] | None:
    if path is None or not path.is_file():
        return None
    turns: deque[dict[str, str]] = deque(maxlen=ANALYSIS_CONTEXT_MAX_TURNS)
    redactions = 0
    try:
        with path.open("rb") as handle:
            handle.seek(0, os.SEEK_END)
            size = handle.tell()
            start = max(0, size - ANALYSIS_CONTEXT_MAX_BYTES)
            handle.seek(start)
            if start:
                handle.readline()
            for raw_line in handle:
                if len(raw_line) > 160_000:
                    continue
                try:
                    value = json.loads(raw_line.decode("utf-8"))
                except (UnicodeDecodeError, json.JSONDecodeError):
                    continue
                if value.get("type") != "response_item":
                    continue
                payload = value.get("payload")
                if not isinstance(payload, dict) or payload.get("type") != "message":
                    continue
                role = payload.get("role")
                if role not in {"user", "assistant"}:
                    continue
                content = payload.get("content")
                if not isinstance(content, list):
                    continue
                pieces: list[str] = []
                for part in content:
                    if not isinstance(part, dict) or part.get("type") not in {"input_text", "output_text"}:
                        continue
                    if isinstance(part.get("text"), str):
                        pieces.append(part["text"])
                text, removed = sanitize_analysis_text("\n".join(pieces))
                redactions += removed
                if text:
                    turns.append({"role": role, "text": text})
    except OSError:
        return None
    if not turns:
        return None
    normalized = list(turns)
    fingerprint = hashlib.sha256(
        json.dumps(normalized, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return {
        "version": 1,
        "fingerprint": fingerprint,
        "turns": normalized,
        "redactions": redactions,
    }


def discover_rollouts(codex_home: Path) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    records: dict[str, dict[str, Any]] = {}
    active_count = 0
    archived_count = 0
    errors = 0
    roots = [(codex_home / "sessions", False), (codex_home / "archived_sessions", True)]
    for root, archived in roots:
        if not root.is_dir():
            continue
        iterator = root.rglob("*.jsonl") if not archived else root.glob("*.jsonl")
        for path in iterator:
            match = UUID_RE.search(path.name)
            meta = session_meta(path)
            thread_id = str(meta.get("id") or meta.get("session_id") or (match.group(1) if match else ""))
            if not thread_id:
                errors += 1
                continue
            try:
                modified = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
            except OSError:
                errors += 1
                continue
            timestamp = parse_time(meta.get("timestamp"))
            record = records.setdefault(thread_id, {"id": thread_id, "created": timestamp, "updated": modified})
            previous_updated = record.get("updated")
            record["created"] = oldest_time(record.get("created"), timestamp)
            record["updated"] = newest_time(record.get("updated"), modified)
            if not record.get("rollout_path") or previous_updated is None or modified >= previous_updated:
                record["rollout_path"] = path
            record["archived"] = bool(record.get("archived")) or archived
            record["thread_source"] = meta.get("thread_source") or record.get("thread_source")
            record["source"] = meta.get("source") or record.get("source")
            if archived:
                archived_count += 1
            else:
                active_count += 1
    report = {
        "available": any(root.is_dir() for root, _ in roots),
        "active_files": active_count,
        "archived_files": archived_count,
        "unique_threads": len(records),
        "unreadable_or_unidentified_files": errors,
    }
    return records, report


def is_subagent(record: dict[str, Any]) -> bool:
    if str(record.get("thread_source") or "").lower() == "subagent":
        return True
    source = record.get("source")
    if isinstance(source, str) and "subagent" in source.lower():
        return True
    if isinstance(source, dict) and "subagent" in source:
        return True
    return False


def stable_device_id(codex_home: Path, requested: str | None) -> str:
    if requested:
        if not re.fullmatch(r"[A-Za-z0-9._-]{1,64}", requested):
            raise SyncError("--device-id must contain only letters, digits, dot, underscore, or hyphen")
        return requested
    installation = codex_home / "installation_id"
    material = ""
    try:
        material = installation.read_text(encoding="utf-8").strip()[:256]
    except OSError:
        material = platform.node() + "|" + str(codex_home.resolve())
    digest = hashlib.sha256(material.encode("utf-8", errors="replace")).hexdigest()[:12]
    return "device-" + digest


def normalize_account_alias(requested: str | None) -> tuple[str, str]:
    alias = (requested or "账号1").strip()
    if not alias or len(alias) > 32 or any(ord(char) < 32 for char in alias):
        raise SyncError("--account-alias must contain 1-32 visible characters")
    account_key = "account-" + hashlib.sha256(alias.encode("utf-8")).hexdigest()[:12]
    return alias, account_key


def redact_title(title: str, thread_id: str) -> str:
    # Do not hash the original title: an attacker with a shortlist of likely
    # titles could otherwise test guesses. The thread id is already exported.
    del title
    return "redacted-" + thread_id[:12]


def normalize_thread(record: dict[str, Any], index: dict[str, Any] | None, rollout: dict[str, Any] | None) -> dict[str, Any]:
    index = index or {}
    rollout = rollout or {}
    created = oldest_time(
        parse_time(record.get("created_at_ms"), milliseconds=True),
        parse_time(record.get("created_at")),
        rollout.get("created"),
    )
    updated = newest_time(
        parse_time(record.get("updated_at_ms"), milliseconds=True),
        parse_time(record.get("recency_at_ms"), milliseconds=True),
        parse_time(record.get("updated_at")),
        parse_time(record.get("recency_at")),
        parse_time(index.get("updated_at")),
        rollout.get("updated"),
    )
    title = str(record.get("title") or record.get("name") or index.get("thread_name") or "").strip()
    thread_id = str(record.get("id") or index.get("id") or rollout.get("id") or "")
    if not title:
        title = f"Codex thread {thread_id[:8]}"
    return {
        "id": thread_id,
        "title": title,
        "created": created or updated,
        "updated": updated or created,
        "archived": bool(record.get("archived")) or bool(rollout.get("archived")),
        "pinned": bool(record.get("is_pinned")),
        "thread_source": record.get("thread_source") or rollout.get("thread_source"),
        "source": record.get("source") or rollout.get("source"),
    }


def classify_task(
    title: str,
    archived: bool,
    pinned: bool,
    goal_status: str | None,
    updated: datetime | None,
    now: datetime,
    stale_days: int,
) -> tuple[str, str, list[str], int, str]:
    normalized_goal = (goal_status or "").lower()
    age_days = max(0, int((now - updated).total_seconds() // 86400)) if updated else stale_days

    if normalized_goal == "blocked":
        return "needs_attention", "high", ["explicit_goal_blocked"], 100, "unblock_goal"
    if normalized_goal in {"complete", "completed", "done"}:
        return "completed", "high", ["explicit_goal_complete"], 0, "none"
    if COMPLETED_RE.search(title):
        return "completed", "medium", ["title_completion_marker"], 0, "none"
    if ATTENTION_RE.search(title):
        return "needs_attention", "medium", ["title_attention_marker"], 95, "review_required_input"
    if archived:
        return "archived", "high", ["codex_archived_flag"], 0, "review_archive_if_needed"
    if normalized_goal in {"active", "in_progress", "in-progress"}:
        return "in_progress", "high", ["explicit_goal_active"], 85, "continue_goal"
    if IN_PROGRESS_RE.search(title):
        return "in_progress", "medium", ["title_progress_marker"], 80, "continue_thread"
    if SUGGESTED_RE.search(title):
        return "suggested_next", "medium", ["title_continue_marker"], 75, "continue_thread"
    if pinned:
        return "suggested_next", "medium", ["codex_pinned_flag"], 70, "continue_thread"
    if age_days >= stale_days:
        score = min(69, 45 + min(age_days, 24))
        return "suggested_next", "low", [f"inactive_at_least_{stale_days}_days"], score, "review_stale_thread"
    return "active", "low", ["recent_non_archived_thread"], max(20, 45 - age_days), "review_or_continue"


def build_snapshot(
    codex_home: Path,
    device_id: str | None = None,
    *,
    account_alias: str = "账号1",
    include_subagents: bool = False,
    redact_titles: bool = False,
    stale_days: int = 7,
    include_analysis_context: bool = False,
    now: datetime | None = None,
) -> dict[str, Any]:
    codex_home = codex_home.expanduser().resolve()
    if not codex_home.is_dir():
        raise SyncError(f"CODEX_HOME does not exist: {codex_home}")
    now = now or utc_now()

    state_path = versioned_db(codex_home, "state")
    goals_path = versioned_db(codex_home, "goals")
    state_rows, state_report = read_state_threads(state_path)
    goals, goals_report = read_goals(goals_path)
    index, index_report = read_session_index(codex_home / "session_index.jsonl")
    rollouts, rollout_report = discover_rollouts(codex_home)

    raw_by_id: dict[str, dict[str, Any]] = {}
    excluded_subagent_ids: set[str] = set()
    for row in state_rows:
        thread_id = str(row.get("id") or "")
        if not thread_id:
            continue
        if is_subagent(row) and not include_subagents:
            excluded_subagent_ids.add(thread_id)
            continue
        raw_by_id[thread_id] = row

    for thread_id, entry in index.items():
        if thread_id not in raw_by_id and thread_id not in excluded_subagent_ids:
            raw_by_id[thread_id] = {"id": thread_id}

    for thread_id, rollout in rollouts.items():
        if thread_id in excluded_subagent_ids:
            continue
        if thread_id not in raw_by_id:
            if is_subagent(rollout) and not include_subagents:
                continue
            raw_by_id[thread_id] = {"id": thread_id}

    resolved_device_id = stable_device_id(codex_home, device_id)
    resolved_account_alias, resolved_account_key = normalize_account_alias(account_alias)
    tasks: list[dict[str, Any]] = []
    for thread_id, row in raw_by_id.items():
        normalized = normalize_thread(row, index.get(thread_id), rollouts.get(thread_id))
        goal = goals.get(thread_id)
        goal_status = str(goal.get("status")) if goal else None
        status, confidence, basis, score, action = classify_task(
            normalized["title"],
            normalized["archived"],
            normalized["pinned"],
            goal_status,
            normalized["updated"],
            now,
            stale_days,
        )
        title = normalized["title"]
        if redact_titles:
            title = redact_title(title, thread_id)
        task: dict[str, Any] = {
            "task_id": f"codex:{resolved_account_key}:{thread_id}",
            "thread_id": thread_id,
            "account_alias": resolved_account_alias,
            "account_key": resolved_account_key,
            "title": title,
            "status": status,
            "status_confidence": confidence,
            "status_basis": basis,
            "attention_score": score,
            "recommended_action": action,
            "created_at": iso_z(normalized["created"]) if normalized["created"] else None,
            "updated_at": iso_z(normalized["updated"]) if normalized["updated"] else None,
            "archived": normalized["archived"],
            "pinned": normalized["pinned"],
            "source_kind": str(normalized.get("thread_source") or "local"),
            "device_ids": [resolved_device_id],
            "locator": {"type": "codex_thread", "thread_id": thread_id},
        }
        if goal:
            task["goal"] = {
                key: goal.get(key)
                for key in ("status", "token_budget", "tokens_used", "time_used_seconds")
                if goal.get(key) is not None
            }
        tasks.append(task)

    tasks.sort(key=lambda task: (task.get("updated_at") or "", task["task_id"]), reverse=True)
    contexts_added = 0
    if include_analysis_context and not redact_titles:
        eligible = [task for task in tasks if task.get("status") not in {"completed", "archived"}]
        recent = eligible[:ANALYSIS_CONTEXT_RECENT_LIMIT]
        backlog = eligible[ANALYSIS_CONTEXT_RECENT_LIMIT:]
        rotating: list[dict[str, Any]] = []
        if backlog:
            window = int(now.timestamp()) // ANALYSIS_CONTEXT_ROTATION_SECONDS
            start = (window * ANALYSIS_CONTEXT_ROTATING_LIMIT) % len(backlog)
            rotating = [
                backlog[(start + offset) % len(backlog)]
                for offset in range(min(ANALYSIS_CONTEXT_ROTATING_LIMIT, len(backlog)))
            ]
        for task in [*recent, *rotating]:
            rollout = rollouts.get(task["thread_id"], {})
            source_path = rollout.get("rollout_path")
            context = extract_analysis_context(source_path if isinstance(source_path, Path) else None)
            if context:
                task["analysis_context"] = context
                contexts_added += 1
    status_counts = dict(sorted(Counter(task["status"] for task in tasks).items()))
    report = {
        "state_db": state_report,
        "goals_db": goals_report,
        "session_index": index_report,
        "rollouts": rollout_report,
        "excluded_subagent_threads": len(excluded_subagent_ids) if not include_subagents else 0,
    }
    return {
        "schema_version": SCHEMA_VERSION,
        "kind": "codex_task_snapshot",
        "generated_at": iso_z(now),
        "device": {"id": resolved_device_id},
        "account": {"alias": resolved_account_alias, "key": resolved_account_key},
        "privacy": {
            "includes_titles": not redact_titles,
            "titles_redacted": redact_titles,
            "includes_message_bodies": bool(contexts_added),
            "message_scope": "Up to 4 sanitized user/assistant turns for 20 recent threads",
            "includes_tool_arguments_or_outputs": False,
            "includes_working_directories": False,
            "includes_absolute_source_paths": False,
        },
        "classification": {
            "stale_after_days": stale_days,
            "semantic_message_analysis": bool(contexts_added),
            "contexts_included": contexts_added,
            "note": "Rules run locally first; sanitized excerpts let the cloud analyzer refine ambiguous states.",
        },
        "source_report": report,
        "stats": {"tasks": len(tasks), "status_counts": status_counts},
        "tasks": tasks,
    }


def validate_snapshot(snapshot: Any, source: str) -> None:
    if not isinstance(snapshot, dict):
        raise SyncError(f"{source}: snapshot must be a JSON object")
    if snapshot.get("schema_version") != SCHEMA_VERSION:
        raise SyncError(f"{source}: unsupported schema_version {snapshot.get('schema_version')!r}")
    if snapshot.get("kind") != "codex_task_snapshot":
        raise SyncError(f"{source}: kind must be codex_task_snapshot")
    if not isinstance(snapshot.get("tasks"), list):
        raise SyncError(f"{source}: tasks must be an array")
    for position, task in enumerate(snapshot["tasks"]):
        if not isinstance(task, dict) or not task.get("task_id") or not task.get("thread_id"):
            raise SyncError(f"{source}: task {position} is missing task_id or thread_id")


def read_json(path: Path) -> dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8") as handle:
            value = json.load(handle)
    except (OSError, json.JSONDecodeError) as exc:
        raise SyncError(f"Cannot read {path}: {exc}") from exc
    validate_snapshot(value, str(path))
    return value


def expand_input_paths(inputs: Iterable[Path]) -> list[Path]:
    expanded: list[Path] = []
    for path in inputs:
        text = str(path)
        if any(character in text for character in "*?["):
            matches = [Path(match) for match in glob.glob(text)]
            if not matches:
                raise SyncError(f"No snapshots matched: {text}")
            expanded.extend(matches)
        elif path.is_dir():
            matches = sorted(path.glob("*.json"))
            if not matches:
                raise SyncError(f"No JSON snapshots found in directory: {path}")
            expanded.extend(matches)
        else:
            expanded.append(path)
    # Resolve duplicates while preserving the user's order.
    result: list[Path] = []
    seen: set[Path] = set()
    for path in expanded:
        resolved = path.expanduser().resolve()
        if resolved not in seen:
            seen.add(resolved)
            result.append(resolved)
    return result


def confidence_rank(value: str | None) -> int:
    return {"low": 1, "medium": 2, "high": 3}.get(str(value), 0)


def time_rank(value: Any) -> float:
    parsed = parse_time(value)
    return parsed.timestamp() if parsed else 0.0


def merge_snapshots(snapshots: Iterable[dict[str, Any]], *, now: datetime | None = None) -> dict[str, Any]:
    now = now or utc_now()
    selected: dict[str, dict[str, Any]] = {}
    observations: Counter[str] = Counter()
    sources: list[dict[str, Any]] = []
    accounts: dict[str, str] = {}

    for snapshot in snapshots:
        validate_snapshot(snapshot, "in-memory snapshot")
        device_id = str((snapshot.get("device") or {}).get("id") or "unknown-device")
        account = snapshot.get("account") or {}
        account_alias = str(account.get("alias") or "账号1")
        account_key = str(account.get("key") or normalize_account_alias(account_alias)[1])
        accounts[account_key] = account_alias
        sources.append({
            "device_id": device_id,
            "account_alias": account_alias,
            "account_key": account_key,
            "generated_at": snapshot.get("generated_at"),
            "tasks": len(snapshot["tasks"]),
        })
        for task in snapshot["tasks"]:
            task_account_alias = str(task.get("account_alias") or account_alias)
            task_account_key = str(task.get("account_key") or normalize_account_alias(task_account_alias)[1])
            thread_id = str(task.get("thread_id") or "")
            task_id = f"codex:{task_account_key}:{thread_id}"
            observations[task_id] += 1
            candidate = json.loads(json.dumps(task))
            candidate["task_id"] = task_id
            candidate["account_alias"] = task_account_alias
            candidate["account_key"] = task_account_key
            devices = set(candidate.get("device_ids") or [])
            devices.add(device_id)
            candidate["device_ids"] = sorted(str(item) for item in devices)
            current = selected.get(task_id)
            if current is None:
                selected[task_id] = candidate
                continue
            current_key = (time_rank(current.get("updated_at")), confidence_rank(current.get("status_confidence")))
            candidate_key = (time_rank(candidate.get("updated_at")), confidence_rank(candidate.get("status_confidence")))
            all_devices = sorted(set(current.get("device_ids") or []) | set(candidate.get("device_ids") or []))
            winner = candidate if candidate_key >= current_key else current
            winner["device_ids"] = all_devices
            selected[task_id] = winner

    tasks = list(selected.values())
    for task in tasks:
        task["sync"] = {"observation_count": observations[task["task_id"]]}
    tasks.sort(key=lambda task: (task.get("attention_score", 0), task.get("updated_at") or ""), reverse=True)
    status_counts = dict(sorted(Counter(task.get("status", "unknown") for task in tasks).items()))
    sources.sort(key=lambda source: (source["device_id"], source.get("generated_at") or ""))
    return {
        "schema_version": SCHEMA_VERSION,
        "kind": "codex_task_merged_board",
        "generated_at": iso_z(now),
        "merge_policy": "newest task updated_at wins; status confidence breaks ties; device ids are unioned",
        "accounts": [{"key": key, "alias": accounts[key]} for key in sorted(accounts)],
        "sources": sources,
        "stats": {"tasks": len(tasks), "status_counts": status_counts},
        "tasks": tasks,
    }


def safe_output_path(output: str, codex_home: Path | None = None) -> Path | None:
    if output == "-":
        return None
    path = Path(output).expanduser().resolve()
    if codex_home is not None:
        source = codex_home.expanduser().resolve()
        try:
            path.relative_to(source)
        except ValueError:
            pass
        else:
            raise SyncError("Refusing to write an export inside CODEX_HOME; choose a separate sync folder")
    return path


def emit_json(value: dict[str, Any], output: str, *, pretty: bool, codex_home: Path | None = None) -> None:
    serialized = json.dumps(
        value,
        ensure_ascii=False,
        indent=2 if pretty else None,
        separators=None if pretty else (",", ":"),
    ) + "\n"
    path = safe_output_path(output, codex_home)
    if path is None:
        sys.stdout.write(serialized)
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(serialized)
        os.replace(temporary_name, path)
    except Exception:
        try:
            os.unlink(temporary_name)
        except OSError:
            pass
        raise


def read_pairing_config(path: Path) -> dict[str, Any]:
    resolved = path.expanduser().resolve()
    try:
        # Windows PowerShell 5.1 writes `-Encoding utf8` with a BOM, while
        # PowerShell 7 writes UTF-8 without one. utf-8-sig accepts both.
        with resolved.open("r", encoding="utf-8-sig") as handle:
            config = json.load(handle)
    except (OSError, json.JSONDecodeError) as exc:
        raise SyncError(f"Cannot read pairing config {resolved}: {exc}") from exc
    if not isinstance(config, dict):
        raise SyncError("Pairing config must be a JSON object")
    required = {
        "site_url",
        "upload_path",
        "device_token",
        "device_id",
        "account_alias",
    }
    missing = sorted(
        key
        for key in required
        if not isinstance(config.get(key), str) or not str(config[key]).strip()
    )
    if missing:
        raise SyncError("Pairing config is missing: " + ", ".join(missing))
    if config.get("version") != 1:
        raise SyncError("Unsupported pairing config version")
    site_url = str(config["site_url"]).strip()
    upload_path = str(config["upload_path"]).strip()
    if not site_url.startswith("https://"):
        raise SyncError("Pairing site_url must use HTTPS")
    if not upload_path.startswith("/api/"):
        raise SyncError("Pairing upload_path must be an API path")
    return config


def upload_snapshot(config: dict[str, Any], snapshot: dict[str, Any]) -> dict[str, Any]:
    url = urllib.parse.urljoin(
        str(config["site_url"]).rstrip("/") + "/",
        str(config["upload_path"]).lstrip("/"),
    )
    payload = json.dumps(
        {
            "scanId": str(uuid.uuid4()),
            "complete": True,
            "agentVersion": AGENT_VERSION,
            "snapshot": snapshot,
        },
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    raw_sites_token = str(config.get("sites_authorization") or "").strip()
    auth_variants = [raw_sites_token, "Bearer " + raw_sites_token] if raw_sites_token else [""]
    last_error = "upload failed"

    for auth_index, sites_token in enumerate(auth_variants):
        for attempt in range(3):
            headers = {
                "Content-Type": "application/json; charset=utf-8",
                "Accept": "application/json",
                "User-Agent": f"ThreadlineAgent/{AGENT_VERSION}",
                "X-Threadline-Device-Token": str(config["device_token"]),
            }
            if sites_token:
                headers["OAI-Sites-Authorization"] = sites_token
            request = urllib.request.Request(
                url,
                data=payload,
                method="POST",
                headers=headers,
            )
            try:
                with urllib.request.urlopen(request, timeout=60) as response:
                    result = json.loads(response.read().decode("utf-8"))
                    if not isinstance(result, dict) or result.get("ok") is not True:
                        raise SyncError("Threadline returned an invalid success response")
                    return result
            except urllib.error.HTTPError as exc:
                last_error = f"HTTP {exc.code}"
                if exc.code in {401, 403} and auth_index == 0:
                    break
                if exc.code == 429 or 500 <= exc.code < 600:
                    if attempt < 2:
                        time.sleep(2 ** attempt)
                        continue
                raise SyncError(f"Threadline upload failed: {last_error}") from exc
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
                last_error = type(exc).__name__
                if attempt < 2:
                    time.sleep(2 ** attempt)
                    continue
                raise SyncError(f"Threadline upload failed: {last_error}") from exc

    raise SyncError(f"Threadline upload failed: {last_error}")


def inspect_home(codex_home: Path) -> dict[str, Any]:
    codex_home = codex_home.expanduser().resolve()
    if not codex_home.is_dir():
        raise SyncError(f"CODEX_HOME does not exist: {codex_home}")
    state_rows, state_report = read_state_threads(versioned_db(codex_home, "state"))
    _, goals_report = read_goals(versioned_db(codex_home, "goals"))
    _, index_report = read_session_index(codex_home / "session_index.jsonl")
    _, rollout_report = discover_rollouts(codex_home)
    thread_sources = Counter(str(row.get("thread_source") or "unknown") for row in state_rows)
    return {
        "kind": "codex_task_source_inspection",
        "generated_at": iso_z(utc_now()),
        "read_only": True,
        "network_used": False,
        "state_db": {
            **state_report,
            "thread_source_counts": dict(sorted(thread_sources.items())),
            "archived_rows": sum(bool(row.get("archived")) for row in state_rows),
            "pinned_rows": sum(bool(row.get("is_pinned")) for row in state_rows),
            "title_rows": sum(bool(row.get("title") or row.get("name")) for row in state_rows),
        },
        "goals_db": goals_report,
        "session_index": index_report,
        "rollouts": rollout_report,
        "privacy": "Counts and schemas only; no titles, messages, cwd values, thread ids, or tool data.",
    }


def default_codex_home() -> Path:
    configured = os.environ.get("CODEX_HOME")
    return Path(configured) if configured else Path.home() / ".codex"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    export_parser = subparsers.add_parser("export", help="Export a metadata-only device snapshot")
    export_parser.add_argument("--codex-home", type=Path, default=default_codex_home())
    export_parser.add_argument("--device-id")
    export_parser.add_argument("--account-alias", default="账号1")
    export_parser.add_argument("--output", default="-")
    export_parser.add_argument("--stale-days", type=int, default=7)
    export_parser.add_argument("--include-subagents", action="store_true")
    export_parser.add_argument("--redact-titles", action="store_true")
    export_parser.add_argument("--compact", action="store_true")

    sync_parser = subparsers.add_parser("sync", help="Scan this device and upload directly to Threadline")
    sync_parser.add_argument("--config", type=Path, required=True)
    sync_parser.add_argument("--codex-home", type=Path, default=default_codex_home())
    sync_parser.add_argument("--output", default="-")
    sync_parser.add_argument("--stale-days", type=int, default=7)
    sync_parser.add_argument("--include-subagents", action="store_true")
    sync_parser.add_argument("--redact-titles", action="store_true")
    sync_parser.add_argument("--no-semantic-context", action="store_true")

    merge_parser = subparsers.add_parser("merge", help="Merge snapshots from multiple devices")
    merge_parser.add_argument("inputs", nargs="+", type=Path)
    merge_parser.add_argument("--output", default="-")
    merge_parser.add_argument("--compact", action="store_true")

    inspect_parser = subparsers.add_parser("inspect", help="Print privacy-safe source counts")
    inspect_parser.add_argument("--codex-home", type=Path, default=default_codex_home())
    inspect_parser.add_argument("--output", default="-")
    inspect_parser.add_argument("--compact", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        if args.command == "export":
            if args.stale_days < 1:
                raise SyncError("--stale-days must be at least 1")
            snapshot = build_snapshot(
                args.codex_home,
                args.device_id,
                account_alias=args.account_alias,
                include_subagents=args.include_subagents,
                redact_titles=args.redact_titles,
                stale_days=args.stale_days,
            )
            emit_json(snapshot, args.output, pretty=not args.compact, codex_home=args.codex_home)
        elif args.command == "sync":
            if args.stale_days < 1:
                raise SyncError("--stale-days must be at least 1")
            config = read_pairing_config(args.config)
            snapshot = build_snapshot(
                args.codex_home,
                str(config["device_id"]),
                account_alias=str(config["account_alias"]),
                include_subagents=args.include_subagents,
                redact_titles=args.redact_titles,
                stale_days=args.stale_days,
                include_analysis_context=not args.no_semantic_context,
            )
            if args.output != "-":
                emit_json(snapshot, args.output, pretty=True, codex_home=args.codex_home)
            result = upload_snapshot(config, snapshot)
            sys.stdout.write(
                json.dumps(
                    {
                        "ok": True,
                        "accepted": result.get("accepted", 0),
                        "analyzed": result.get("analyzed", 0),
                        "synced_at": result.get("syncedAt"),
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )
        elif args.command == "merge":
            snapshots = [read_json(path) for path in expand_input_paths(args.inputs)]
            merged = merge_snapshots(snapshots)
            emit_json(merged, args.output, pretty=not args.compact, codex_home=default_codex_home())
        elif args.command == "inspect":
            report = inspect_home(args.codex_home)
            emit_json(report, args.output, pretty=not args.compact, codex_home=args.codex_home)
        else:
            parser.error("unknown command")
        return 0
    except (SyncError, OSError, sqlite3.Error) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
