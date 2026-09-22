import { env } from "cloudflare:workers";
import { classifyTaskLifecycle } from "@/lib/server/task-analysis";
import { BOARD_NAMESPACE, requireSiteViewer } from "@/lib/server/site-auth";
import { readTasks, statementFor } from "@/lib/server/task-store";
import type { Task } from "@/lib/tasks";

export const dynamic = "force-dynamic";

const REVIEW_TAG = "整理v2";
const BATCH_SIZE = 20;

function isReviewCandidate(task: Task) {
  return (
    !task.manualOverride &&
    !task.tags.includes(REVIEW_TAG) &&
    !task.tags.includes("永不归档") &&
    !task.unread &&
    task.priority !== "high" &&
    task.status !== "mine" &&
    task.status !== "running" &&
    task.status !== "done" &&
    task.status !== "reference" &&
    task.status !== "archived"
  );
}

export async function POST(request: Request) {
  const unauthorized = requireSiteViewer(request);
  if (unauthorized) return unauthorized;

  const tasks = await readTasks(BOARD_NAMESPACE);
  const queue = tasks
    .filter(isReviewCandidate)
    .sort((a, b) => new Date(a.lastActivityAt).getTime() - new Date(b.lastActivityAt).getTime());
  const candidates = queue.slice(0, BATCH_SIZE);
  if (!candidates.length) {
    return Response.json({ tasks, reviewed: 0, remaining: 0, archived: 0, referenced: 0 });
  }

  const decisions = await classifyTaskLifecycle(candidates);
  if (!decisions.size) {
    return Response.json({ tasks, reviewed: 0, remaining: queue.length, archived: 0, referenced: 0, paused: true });
  }

  const now = new Date().toISOString();
  let archived = 0;
  let referenced = 0;
  const updated = candidates.flatMap((task) => {
    const decision = decisions.get(task.id);
    if (!decision) return [];
    const tags = Array.from(new Set([...task.tags, REVIEW_TAG]));
    const canArchive = decision.bucket === "archive" && decision.confidence >= 0.93;
    const canReference = decision.bucket === "reference" && decision.confidence >= 0.78;
    if (canArchive) archived += 1;
    if (canReference) referenced += 1;
    return [{
      ...task,
      tags,
      status: canArchive ? "archived" as const : canReference ? "reference" as const : task.status,
      priority: canArchive || canReference ? "low" as const : task.priority,
      unread: canArchive || canReference ? false : task.unread,
      score: canArchive ? 0 : canReference ? 12 : task.score,
      reason: canArchive
        ? `AI 整理 · ${decision.reason}`
        : canReference
          ? `AI 整理 · ${decision.reason}`
          : task.reason,
      nextAction: canArchive
        ? "需要时从低价值归档恢复"
        : canReference
          ? "需要时从资料库重新激活"
          : task.nextAction,
      version: (task.version ?? 1) + 1,
      updatedAt: now,
    }];
  });

  await env.DB.batch(updated.map((task) => statementFor(task, BOARD_NAMESPACE)));
  const nextTasks = await readTasks(BOARD_NAMESPACE);
  return Response.json({
    tasks: nextTasks,
    reviewed: updated.length,
    remaining: Math.max(0, queue.length - updated.length),
    archived,
    referenced,
  });
}

