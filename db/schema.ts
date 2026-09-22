import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    sourceThreadId: text("source_thread_id"),
    sourceKind: text("source_kind").notNull(),
    accountAlias: text("account_alias").notNull().default("账号1"),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    nextAction: text("next_action").notNull(),
    status: text("status").notNull(),
    priority: text("priority").notNull(),
    project: text("project").notNull(),
    device: text("device").notNull(),
    hostOnline: integer("host_online", { mode: "boolean" }).notNull(),
    unread: integer("unread", { mode: "boolean" }).notNull(),
    score: integer("score").notNull(),
    reason: text("reason").notNull(),
    dueAt: text("due_at"),
    snoozedUntil: text("snoozed_until"),
    lastActivityAt: text("last_activity_at").notNull(),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
    tags: text("tags").notNull(),
    version: integer("version").notNull().default(1),
    manualOverride: integer("manual_override", { mode: "boolean" }).notNull().default(false),
    updatedAt: text("updated_at").notNull().default(""),
  },
  (table) => [
    index("idx_tasks_user_status").on(table.userId, table.status),
    index("idx_tasks_user_activity").on(table.userId, table.lastActivityAt),
    index("idx_tasks_user_account_status").on(table.userId, table.accountAlias, table.status),
  ],
);

export const deviceSources = sqliteTable(
  "device_sources",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    deviceName: text("device_name").notNull(),
    accountAlias: text("account_alias").notNull(),
    tokenHash: text("token_hash").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
    lastSeenAt: text("last_seen_at"),
    lastSyncAt: text("last_sync_at"),
    lastScanId: text("last_scan_id"),
    agentVersion: text("agent_version"),
    recordCount: integer("record_count").notNull().default(0),
    revokedAt: text("revoked_at"),
  },
  (table) => [
    uniqueIndex("idx_device_sources_token_hash").on(table.tokenHash),
    index("idx_device_sources_user_status").on(table.userId, table.revokedAt),
  ],
);

export const taskSourcePresence = sqliteTable(
  "task_source_presence",
  {
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    sourceId: text("source_id")
      .notNull()
      .references(() => deviceSources.id, { onDelete: "cascade" }),
    lastScanId: text("last_scan_id").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    sourceRevision: text("source_revision"),
    isPresent: integer("is_present", { mode: "boolean" }).notNull().default(true),
  },
  (table) => [
    primaryKey({ columns: [table.taskId, table.sourceId] }),
    index("idx_task_source_presence_source").on(table.sourceId, table.isPresent),
  ],
);

export const taskAiAnalysis = sqliteTable(
  "task_ai_analysis",
  {
    userId: text("user_id").notNull(),
    taskId: text("task_id").notNull(),
    contextHash: text("context_hash").notNull(),
    semanticState: text("semantic_state").notNull(),
    confidence: integer("confidence").notNull(),
    reason: text("reason").notNull(),
    nextAction: text("next_action").notNull(),
    model: text("model").notNull(),
    analyzedAt: text("analyzed_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.taskId] }),
    index("idx_task_ai_analysis_user_time").on(table.userId, table.analyzedAt),
  ],
);

export const executiveSummaryCache = sqliteTable("executive_summary_cache", {
  userId: text("user_id").primaryKey(),
  fingerprint: text("fingerprint").notNull(),
  summary: text("summary").notNull(),
  actions: text("actions").notNull(),
  model: text("model").notNull(),
  generatedAt: text("generated_at").notNull(),
});
