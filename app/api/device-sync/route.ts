import { env } from "cloudflare:workers";
import { normalizeSnapshotTask, type SnapshotTask } from "@/lib/snapshot-task";
import {
  analyzeChangedTasks,
  applyTaskAnalysis,
  parseAnalysisContext,
  type TaskAnalysisInput,
} from "@/lib/server/task-analysis";
import {
  dbId,
  readTasks,
  refreshSourceAvailability,
  statementFor,
} from "@/lib/server/task-store";
import type { Task } from "@/lib/tasks";

export const dynamic = "force-dynamic";

type DeviceCredentialRow = {
  id: string;
  user_id: string;
  device_name: string;
  account_alias: string;
  last_scan_id: string | null;
  revoked_at: string | null;
};

type SnapshotBody = {
  scanId?: unknown;
  snapshotId?: unknown;
  complete?: unknown;
  agentVersion?: unknown;
  snapshot?: {
    schema_version?: unknown;
    kind?: unknown;
    device?: { id?: unknown };
    account?: { alias?: unknown };
    tasks?: unknown;
  };
};

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

type PreparedStatement = ReturnType<typeof statementFor>;

async function runBatches(statements: PreparedStatement[]) {
  for (let index = 0; index < statements.length; index += 80) {
    await env.DB.batch(statements.slice(index, index + 80));
  }
}

export async function POST(request: Request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 2_500_000) {
    return Response.json({ error: "Snapshot is too large" }, { status: 413 });
  }

  const token = request.headers.get("x-threadline-device-token")?.trim();
  if (!token || token.length > 256) {
    return Response.json({ error: "Missing device credential" }, { status: 401 });
  }

  const credential = await env.DB.prepare(
    `SELECT id, user_id, device_name, account_alias, last_scan_id, revoked_at
     FROM device_sources WHERE token_hash = ?`,
  )
    .bind(await hashToken(token))
    .first<DeviceCredentialRow>();
  if (!credential || credential.revoked_at) {
    return Response.json({ error: "Invalid or revoked device credential" }, { status: 401 });
  }

  let body: SnapshotBody;
  try {
    body = (await request.json()) as SnapshotBody;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const scanId = typeof body.scanId === "string" ? body.scanId.trim() : "";
  const snapshotId = typeof body.snapshotId === "string" ? body.snapshotId.trim() : scanId;
  const complete = body.complete === true;
  const snapshot = body.snapshot;
  const tasks = Array.isArray(snapshot?.tasks) ? snapshot.tasks : null;
  if (
    scanId.length < 8 ||
    scanId.length > 128 ||
    snapshotId.length < 8 ||
    snapshotId.length > 128 ||
    (body.complete !== true && body.complete !== false) ||
    snapshot?.kind !== "codex_task_snapshot" ||
    snapshot?.schema_version !== 1 ||
    snapshot?.device?.id !== credential.id ||
    snapshot?.account?.alias !== credential.account_alias ||
    !tasks
  ) {
    return Response.json({ error: "Snapshot metadata does not match this device" }, { status: 400 });
  }
  if (tasks.length > 2000) {
    return Response.json({ error: "Snapshot contains too many tasks" }, { status: 413 });
  }

  const now = new Date().toISOString();
  if (credential.last_scan_id === scanId) {
    await env.DB.prepare(
      "UPDATE device_sources SET last_seen_at = ? WHERE id = ?",
    )
      .bind(now, credential.id)
      .run();
    return Response.json({ ok: true, duplicate: true, accepted: tasks.length, syncedAt: now });
  }

  const existing = await readTasks(credential.user_id);
  const byAccountAndThread = new Map<string, Task>(
    existing
      .filter((task) => task.sourceThreadId)
      .map((task) => [`${task.sourceKind}\u0000${task.accountAlias}\u0000${task.sourceThreadId}`, task]),
  );

  const normalizedRecords: Array<{
    incoming: Task;
    match: Task | undefined;
    storedTaskId: string;
    analysisInput: TaskAnalysisInput;
  }> = [];
  const seenTaskIds = new Set<string>();
  tasks.forEach((raw, index) => {
    if (!raw || typeof raw !== "object") return;
    const incoming = normalizeSnapshotTask(raw as SnapshotTask, index);
    if (!incoming.sourceThreadId || incoming.accountAlias !== credential.account_alias) return;

    const match = byAccountAndThread.get(
      `${incoming.sourceKind}\u0000${incoming.accountAlias}\u0000${incoming.sourceThreadId}`,
    );
    const storedTaskId = dbId(credential.user_id, match?.id ?? incoming.id);
    if (seenTaskIds.has(storedTaskId)) return;
    seenTaskIds.add(storedTaskId);
    normalizedRecords.push({
      incoming,
      match,
      storedTaskId,
      analysisInput: {
        taskId: storedTaskId,
        title: incoming.title,
        heuristicStatus: incoming.status,
        updatedAt: incoming.updatedAt ?? incoming.lastActivityAt,
        context: parseAnalysisContext((raw as SnapshotTask).analysis_context),
      },
    });
  });

  const analyses = await analyzeChangedTasks(
    credential.user_id,
    normalizedRecords
      .filter((record) => !record.match?.manualOverride)
      .map((record) => record.analysisInput),
  );
  const statements: PreparedStatement[] = [];
  normalizedRecords.forEach(({ incoming, match, storedTaskId }) => {
    const keepManualState = Boolean(match?.manualOverride);
    const analyzed = keepManualState ? incoming : applyTaskAnalysis(incoming, analyses.get(storedTaskId));
    const merged = {
      ...analyzed,
      ...incoming,
      id: match?.id ?? incoming.id,
      device: credential.device_name,
      hostOnline: true,
      status: keepManualState ? match!.status : analyzed.status,
      priority: keepManualState ? match!.priority : analyzed.priority,
      reason: keepManualState ? match!.reason : analyzed.reason,
      nextAction: keepManualState ? match!.nextAction : analyzed.nextAction,
      unread: keepManualState ? match!.unread : analyzed.unread,
      score: keepManualState ? match!.score : analyzed.score,
      tags: keepManualState ? match!.tags : analyzed.tags,
      completedAt: keepManualState ? match!.completedAt : incoming.completedAt,
      snoozedUntil: keepManualState ? match!.snoozedUntil : incoming.snoozedUntil,
      manualOverride: keepManualState,
      version: match?.version ?? 1,
      updatedAt: incoming.updatedAt ?? incoming.lastActivityAt,
    };
    statements.push(statementFor(merged, credential.user_id));
    statements.push(
      env.DB.prepare(
        `INSERT INTO task_source_presence (
          task_id, source_id, last_scan_id, last_seen_at, source_revision, is_present
        ) VALUES (?, ?, ?, ?, ?, 1)
        ON CONFLICT(task_id, source_id) DO UPDATE SET
          last_scan_id = excluded.last_scan_id,
          last_seen_at = excluded.last_seen_at,
          source_revision = excluded.source_revision,
          is_present = 1`,
      ).bind(
        storedTaskId,
        credential.id,
        snapshotId,
        now,
        incoming.updatedAt ?? incoming.lastActivityAt,
      ),
    );
  });

  await runBatches(statements);
  if (complete) {
    await env.DB.prepare(
      "UPDATE task_source_presence SET is_present = 0 WHERE source_id = ? AND last_scan_id <> ?",
    )
      .bind(credential.id, snapshotId)
      .run();
  }
  const present = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM task_source_presence WHERE source_id = ? AND is_present = 1",
  )
    .bind(credential.id)
    .first<{ count: number }>();
  await env.DB.prepare(
    `UPDATE device_sources
     SET last_seen_at = ?, last_sync_at = ?, last_scan_id = ?, agent_version = ?, record_count = ?
     WHERE id = ?`,
  )
    .bind(
      now,
      now,
      scanId,
      typeof body.agentVersion === "string" ? body.agentVersion.slice(0, 40) : null,
      Number(present?.count ?? seenTaskIds.size),
      credential.id,
    )
    .run();
  await refreshSourceAvailability(credential.user_id);

  return Response.json({
    ok: true,
    accepted: seenTaskIds.size,
    received: tasks.length,
    analyzed: analyses.size,
    complete,
    recordCount: Number(present?.count ?? seenTaskIds.size),
    syncedAt: now,
  });
}
