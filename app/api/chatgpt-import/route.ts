import { env } from "cloudflare:workers";
import type { ChatGPTImportConversation, ChatGPTImportTurn } from "@/lib/chatgpt-import";
import {
  analyzeChangedTasks,
  applyTaskAnalysis,
  type AnalysisContext,
  type TaskAnalysisInput,
} from "@/lib/server/task-analysis";
import { BOARD_NAMESPACE, requireSiteViewer } from "@/lib/server/site-auth";
import { readTasks, statementFor } from "@/lib/server/task-store";
import type { Task } from "@/lib/tasks";

export const dynamic = "force-dynamic";

const ACCOUNT_ALIASES = new Set(["账号1", "账号2"]);
const MAX_CONVERSATIONS_PER_REQUEST = 24;

function safeText(value: unknown, limit: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/```[\s\S]*?```/g, "[代码块已省略]")
    .replace(/\bsk-[a-z0-9_-]{12,}\b/gi, "[密钥已删除]")
    .replace(/[a-z]:\\(?:[^\\\s]+\\){1,}[^\s]*/gi, "[本地路径已省略]")
    .replace(/\/(?:Users|home)\/[^\s]+/gi, "[本地路径已省略]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function safeIso(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeTurns(value: unknown): ChatGPTImportTurn[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(-4)
    .map((raw) => {
      if (!raw || typeof raw !== "object") return null;
      const item = raw as Record<string, unknown>;
      const role = item.role === "user" || item.role === "assistant" ? item.role : null;
      const text = safeText(item.text, 1_600);
      return role && text ? { role, text } : null;
    })
    .filter((turn): turn is ChatGPTImportTurn => Boolean(turn));
}

function heuristicPresentation(turns: ChatGPTImportTurn[]) {
  const lastRole = turns.at(-1)?.role;
  if (lastRole === "assistant") {
    return {
      status: "mine" as const,
      priority: "medium" as const,
      unread: true,
      score: 74,
      reason: "ChatGPT 已回复 · 等你决定是否继续",
      nextAction: "打开原对话并决定下一步",
    };
  }
  return {
    status: "suggested" as const,
    priority: "medium" as const,
    unread: false,
    score: 66,
    reason: "对话仍有开放问题 · 建议回看",
    nextAction: "回到原对话继续推进",
  };
}

export async function POST(request: Request) {
  const unauthorized = requireSiteViewer(request);
  if (unauthorized) return unauthorized;

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 1_500_000) {
    return Response.json({ error: "导入批次过大" }, { status: 413 });
  }

  let body: { accountAlias?: unknown; conversations?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "JSON 格式错误" }, { status: 400 });
  }
  const accountAlias = safeText(body.accountAlias, 32);
  if (!ACCOUNT_ALIASES.has(accountAlias) || !Array.isArray(body.conversations)) {
    return Response.json({ error: "请选择正确账号并提供对话数据" }, { status: 400 });
  }
  if (body.conversations.length > MAX_CONVERSATIONS_PER_REQUEST) {
    return Response.json({ error: "每批最多导入 24 个对话" }, { status: 413 });
  }

  const now = new Date().toISOString();
  const existing = await readTasks(BOARD_NAMESPACE);
  const existingByThread = new Map(
    existing
      .filter((task) => task.sourceKind === "chatgpt" && task.sourceThreadId)
      .map((task) => [`${task.accountAlias}\u0000${task.sourceThreadId}`, task]),
  );

  const records: Array<{
    task: Task;
    match?: Task;
    analysisInput: TaskAnalysisInput;
  }> = [];
  for (const raw of body.conversations as ChatGPTImportConversation[]) {
    if (!raw || typeof raw !== "object") continue;
    const id = safeText(raw.id, 240);
    const title = safeText(raw.title, 240);
    if (!id || !title) continue;
    const turns = safeTurns(raw.turns);
    const createdAt = safeIso(raw.createdAt, now);
    const updatedAt = safeIso(raw.updatedAt, createdAt);
    const presentation = heuristicPresentation(turns);
    const latestAssistant = [...turns].reverse().find((turn) => turn.role === "assistant")?.text;
    const match = existingByThread.get(`${accountAlias}\u0000${id}`);
    const taskId = match?.id ?? `chatgpt:${accountAlias}:${id}`;
    const context: AnalysisContext | null = turns.length
      ? {
          version: 1,
          fingerprint: await sha256(JSON.stringify(turns)),
          turns,
        }
      : null;
    const task: Task = {
      id: taskId,
      sourceThreadId: id,
      sourceKind: "chatgpt",
      accountAlias,
      title,
      summary: latestAssistant
        ? safeText(latestAssistant, 260)
        : "从 ChatGPT 云端历史导入，等待智能判断当前状态。",
      nextAction: presentation.nextAction,
      status: presentation.status,
      priority: presentation.priority,
      project: "ChatGPT 对话",
      device: "ChatGPT 云端",
      hostOnline: true,
      unread: presentation.unread,
      score: presentation.score,
      reason: presentation.reason,
      dueAt: null,
      snoozedUntil: null,
      lastActivityAt: updatedAt,
      createdAt,
      completedAt: null,
      tags: ["ChatGPT", "云端", accountAlias],
      version: match?.version ?? 1,
      manualOverride: match?.manualOverride ?? false,
      updatedAt,
    };
    records.push({
      task,
      match,
      analysisInput: {
        taskId,
        title,
        heuristicStatus: task.status,
        updatedAt,
        context,
      },
    });
  }

  const analyses = await analyzeChangedTasks(
    BOARD_NAMESPACE,
    records.filter((record) => !record.match?.manualOverride).map((record) => record.analysisInput),
  );
  const statements = records.map(({ task, match }) => {
    const keepManualState = Boolean(match?.manualOverride);
    const analyzed = keepManualState ? task : applyTaskAnalysis(task, analyses.get(task.id));
    const merged: Task = keepManualState
      ? {
          ...analyzed,
          status: match!.status,
          priority: match!.priority,
          reason: match!.reason,
          nextAction: match!.nextAction,
          completedAt: match!.completedAt,
          snoozedUntil: match!.snoozedUntil,
          manualOverride: true,
        }
      : analyzed;
    return statementFor(merged, BOARD_NAMESPACE);
  });
  if (statements.length) await env.DB.batch(statements);

  return Response.json({
    ok: true,
    imported: records.length,
    analyzed: analyses.size,
  });
}
