import type { Task, TaskPriority, TaskStatus } from "./tasks";

export type SnapshotTask = {
  task_id?: unknown;
  thread_id?: unknown;
  account_alias?: unknown;
  source_kind?: unknown;
  summary?: unknown;
  title?: unknown;
  status?: unknown;
  attention_score?: unknown;
  recommended_action?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  device_ids?: unknown;
  analysis_context?: unknown;
};

const statusMap: Record<string, TaskStatus> = {
  needs_attention: "mine",
  in_progress: "running",
  active: "inbox",
  suggested_next: "suggested",
  archived: "suggested",
  completed: "done",
  blocked: "waiting",
};

const actionLabels: Record<string, string> = {
  unblock_goal: "查看阻塞原因并补充所需信息",
  review_required_input: "查看原对话并完成待确认事项",
  continue_goal: "继续执行当前目标",
  continue_thread: "回到原对话继续推进",
  review_stale_thread: "回看最后进展并决定下一步",
  review_archive_if_needed: "确认归档任务是否已经完成",
  review_or_continue: "查看最近进展并决定是否继续",
  none: "无需下一步",
};

function priorityFor(score: number): TaskPriority {
  if (score >= 85) return "high";
  if (score < 45) return "low";
  return "medium";
}

export function normalizeSnapshotTask(value: SnapshotTask, index = 0): Task {
  const rawStatus = String(value.status ?? "active");
  const score = Number(value.attention_score ?? 45);
  const updatedAt = String(value.updated_at ?? new Date().toISOString());
  const createdAt = String(value.created_at ?? updatedAt);
  const devices = Array.isArray(value.device_ids) ? value.device_ids.map(String) : [];
  const accountAlias =
    typeof value.account_alias === "string" && value.account_alias.trim()
      ? value.account_alias.trim()
      : "账号1";
  const rawAction = String(value.recommended_action ?? "review_or_continue");
  const status = statusMap[rawStatus] ?? "inbox";
  const sourceKind = value.source_kind === "chatgpt" ? "chatgpt" : "codex";

  return {
    id: String(value.task_id ?? `import-${Date.now()}-${index}`),
    sourceThreadId: typeof value.thread_id === "string" ? value.thread_id : null,
    sourceKind,
    accountAlias,
    title: String(value.title ?? (sourceKind === "chatgpt" ? "未命名 ChatGPT 对话" : "未命名 Codex 对话")),
    summary:
      typeof value.summary === "string" && value.summary.trim()
        ? value.summary.trim().slice(0, 320)
        : sourceKind === "chatgpt"
          ? "由 ChatGPT 网页连接器增量同步。"
          : "由只读 Codex 本地扫描器同步，未上传消息正文和工作目录。",
    nextAction: actionLabels[rawAction] ?? "回到原对话确认下一步",
    status,
    priority: priorityFor(score),
    project: sourceKind === "chatgpt" ? "ChatGPT 对话" : "Codex 对话",
    device: devices.length ? devices.join("、") : "来源设备",
    hostOnline: true,
    unread: rawStatus === "needs_attention",
    score: Number.isFinite(score) ? score : 45,
    reason:
      rawStatus === "suggested_next"
        ? "停滞较久 · 建议回看"
        : rawStatus === "needs_attention"
          ? "存在阻塞或待确认"
          : rawStatus === "in_progress"
            ? "目标仍在进行"
            : "来自设备自动同步",
    dueAt: null,
    snoozedUntil: null,
    lastActivityAt: updatedAt,
    createdAt,
    completedAt: rawStatus === "completed" ? updatedAt : null,
    tags: ["自动同步", sourceKind === "chatgpt" ? "ChatGPT" : "Codex", accountAlias],
    updatedAt,
  };
}

export function normalizeSnapshotTasks(values: unknown[]): Task[] {
  return values
    .filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object"))
    .map((value, index) => {
      if (typeof value.nextAction === "string" && typeof value.lastActivityAt === "string") {
        return {
          ...(value as unknown as Task),
          accountAlias:
            typeof value.accountAlias === "string" && value.accountAlias.trim()
              ? value.accountAlias.trim()
              : "账号1",
        };
      }
      return normalizeSnapshotTask(value, index);
    });
}
