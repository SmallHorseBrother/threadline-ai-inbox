import { env } from "cloudflare:workers";
import type { Task } from "@/lib/tasks";

export type TaskRow = {
  id: string;
  source_thread_id: string | null;
  source_kind: Task["sourceKind"];
  account_alias: string;
  title: string;
  summary: string;
  next_action: string;
  status: Task["status"];
  priority: Task["priority"];
  project: string;
  device: string;
  host_online: number;
  unread: number;
  score: number;
  reason: string;
  due_at: string | null;
  snoozed_until: string | null;
  last_activity_at: string;
  created_at: string;
  completed_at: string | null;
  tags: string;
  version?: number;
  manual_override?: number;
  updated_at?: string;
};

const upsertSql = `INSERT INTO tasks (
  id, user_id, source_thread_id, source_kind, account_alias, title, summary, next_action,
  status, priority, project, device, host_online, unread, score, reason,
  due_at, snoozed_until, last_activity_at, created_at, completed_at, tags,
  version, manual_override, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  source_thread_id = excluded.source_thread_id,
  source_kind = excluded.source_kind,
  account_alias = excluded.account_alias,
  title = excluded.title,
  summary = excluded.summary,
  next_action = excluded.next_action,
  status = excluded.status,
  priority = excluded.priority,
  project = excluded.project,
  device = excluded.device,
  host_online = excluded.host_online,
  unread = excluded.unread,
  score = excluded.score,
  reason = excluded.reason,
  due_at = excluded.due_at,
  snoozed_until = excluded.snoozed_until,
  last_activity_at = excluded.last_activity_at,
  completed_at = excluded.completed_at,
  tags = excluded.tags,
  version = excluded.version,
  manual_override = excluded.manual_override,
  updated_at = excluded.updated_at`;

export function dbId(uid: string, id: string) {
  return id.startsWith(`${uid}:`) ? id : `${uid}:${id}`;
}

export function statementFor(task: Task, uid: string) {
  return env.DB.prepare(upsertSql).bind(
    dbId(uid, task.id),
    uid,
    task.sourceThreadId,
    task.sourceKind,
    task.accountAlias || "账号1",
    task.title,
    task.summary,
    task.nextAction,
    task.status,
    task.priority,
    task.project,
    task.device,
    task.hostOnline ? 1 : 0,
    task.unread ? 1 : 0,
    task.score,
    task.reason,
    task.dueAt,
    task.snoozedUntil,
    task.lastActivityAt,
    task.createdAt,
    task.completedAt,
    JSON.stringify(task.tags),
    task.version ?? 1,
    task.manualOverride ? 1 : 0,
    task.updatedAt ?? task.lastActivityAt,
  );
}

function safeTags(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function fromRow(row: TaskRow): Task {
  return {
    id: row.id,
    sourceThreadId: row.source_thread_id,
    sourceKind: row.source_kind,
    accountAlias: row.account_alias || "账号1",
    title: row.title,
    summary: row.summary,
    nextAction: row.next_action,
    status: row.status,
    priority: row.priority,
    project: row.project,
    device: row.device,
    hostOnline: Boolean(row.host_online),
    unread: Boolean(row.unread),
    score: row.score,
    reason: row.reason,
    dueAt: row.due_at,
    snoozedUntil: row.snoozed_until,
    lastActivityAt: row.last_activity_at,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    tags: safeTags(row.tags),
    version: row.version ?? 1,
    manualOverride: Boolean(row.manual_override),
    updatedAt: row.updated_at || row.last_activity_at,
  };
}

export async function readTasks(uid: string): Promise<Task[]> {
  const result = await env.DB.prepare(
    "SELECT * FROM tasks WHERE user_id = ? ORDER BY last_activity_at DESC",
  )
    .bind(uid)
    .all<TaskRow>();
  return result.results.map(fromRow);
}

export async function refreshSourceAvailability(uid: string) {
  await env.DB.prepare(
    `UPDATE tasks
     SET host_online = CASE WHEN EXISTS (
       SELECT 1 FROM task_source_presence presence
       WHERE presence.task_id = tasks.id AND presence.is_present = 1
     ) THEN 1 ELSE 0 END,
     device = COALESCE((
       SELECT GROUP_CONCAT(source.device_name, '、')
       FROM task_source_presence presence
       JOIN device_sources source ON source.id = presence.source_id
       WHERE presence.task_id = tasks.id
         AND presence.is_present = 1
         AND source.revoked_at IS NULL
     ), device)
     WHERE user_id = ?
       AND EXISTS (
         SELECT 1 FROM task_source_presence known
         WHERE known.task_id = tasks.id
       )`,
  )
    .bind(uid)
    .run();
}

export function isTaskLike(value: unknown): value is Task {
  if (!value || typeof value !== "object") return false;
  const task = value as Partial<Task>;
  return Boolean(
    typeof task.id === "string" &&
      typeof task.title === "string" &&
      typeof task.nextAction === "string" &&
      typeof task.status === "string",
  );
}

export function sanitizePatch(patch: Partial<Task>): Partial<Task> {
  const allowed: (keyof Task)[] = [
    "title",
    "summary",
    "nextAction",
    "accountAlias",
    "status",
    "priority",
    "project",
    "device",
    "hostOnline",
    "unread",
    "score",
    "reason",
    "dueAt",
    "snoozedUntil",
    "lastActivityAt",
    "completedAt",
    "tags",
    "manualOverride",
    "updatedAt",
  ];
  return Object.fromEntries(
    allowed.filter((key) => key in patch).map((key) => [key, patch[key]]),
  ) as Partial<Task>;
}
