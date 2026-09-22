import { env } from "cloudflare:workers";
import { createSeedTasks, type Task } from "@/lib/tasks";
import { BOARD_NAMESPACE, requireSiteViewer } from "@/lib/server/site-auth";
import {
  fromRow,
  isTaskLike,
  readTasks,
  sanitizePatch,
  statementFor,
  type TaskRow,
} from "@/lib/server/task-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = requireSiteViewer(request);
  if (unauthorized) return unauthorized;

  let tasks = await readTasks(BOARD_NAMESPACE);
  if (!tasks.length) {
    await env.DB.batch(createSeedTasks().map((task) => statementFor(task, BOARD_NAMESPACE)));
    tasks = await readTasks(BOARD_NAMESPACE);
  }
  return Response.json({ tasks, syncedAt: new Date().toISOString() });
}

export async function POST(request: Request) {
  const unauthorized = requireSiteViewer(request);
  if (unauthorized) return unauthorized;

  const body = (await request.json()) as {
    action?: "update" | "create" | "import" | "reset";
    id?: string;
    baseVersion?: number;
    patch?: Partial<Task>;
    task?: Task;
    tasks?: Task[];
  };

  if (body.action === "reset") {
    await env.DB.prepare("DELETE FROM tasks WHERE user_id = ?")
      .bind(BOARD_NAMESPACE)
      .run();
    await env.DB.batch(createSeedTasks().map((task) => statementFor(task, BOARD_NAMESPACE)));
    return Response.json({ tasks: await readTasks(BOARD_NAMESPACE) });
  }

  if (body.action === "import" && Array.isArray(body.tasks)) {
    const safeTasks = body.tasks.slice(0, 1000).filter(isTaskLike);
    if (safeTasks.length) {
      const existing = await readTasks(BOARD_NAMESPACE);
      const byAccountAndSourceThread = new Map<string, Task>(
        existing
          .filter((task) => task.sourceThreadId)
          .map((task) => [`${task.sourceKind}\u0000${task.accountAlias || "账号1"}\u0000${task.sourceThreadId}`, task]),
      );
      const mergedTasks = safeTasks.map((task) => {
        const accountAlias = task.accountAlias?.trim() || "账号1";
        const match = task.sourceThreadId
          ? byAccountAndSourceThread.get(`${task.sourceKind}\u0000${accountAlias}\u0000${task.sourceThreadId}`)
          : undefined;
        if (!match) return task;

        const keepManualState = Boolean(match.manualOverride);
        return {
          ...task,
          id: match.id,
          status: keepManualState ? match.status : task.status,
          priority: keepManualState ? match.priority : task.priority,
          reason: keepManualState ? match.reason : task.reason,
          completedAt: keepManualState ? match.completedAt : task.completedAt,
          snoozedUntil: keepManualState ? match.snoozedUntil : task.snoozedUntil,
          manualOverride: keepManualState,
          version: Math.max(match.version ?? 1, task.version ?? 1),
          updatedAt: task.updatedAt ?? task.lastActivityAt,
        };
      });
      await env.DB.batch(
        mergedTasks.map((task) => statementFor(task, BOARD_NAMESPACE)),
      );
    }
    return Response.json({ tasks: await readTasks(BOARD_NAMESPACE) });
  }

  if (body.action === "create" && body.task && isTaskLike(body.task)) {
    await statementFor(body.task, BOARD_NAMESPACE).run();
    return Response.json({ tasks: await readTasks(BOARD_NAMESPACE) });
  }

  if (body.action === "update" && body.id && body.patch) {
    const existing = await env.DB.prepare(
      "SELECT * FROM tasks WHERE id = ? AND user_id = ?",
    )
      .bind(body.id, BOARD_NAMESPACE)
      .first<TaskRow>();
    if (!existing) return Response.json({ error: "Task not found" }, { status: 404 });
    const current = fromRow(existing);
    if (typeof body.baseVersion === "number" && body.baseVersion !== current.version) {
      return Response.json(
        {
          error: "Task changed on another device",
          conflict: current,
          tasks: await readTasks(BOARD_NAMESPACE),
        },
        { status: 409 },
      );
    }
    const patch = sanitizePatch(body.patch);
    const manualOverride =
      patch.status !== undefined || patch.priority !== undefined
        ? true
        : current.manualOverride;
    const merged = {
      ...current,
      ...patch,
      id: existing.id,
      version: (current.version ?? 1) + 1,
      manualOverride,
      updatedAt: new Date().toISOString(),
    };
    await statementFor(merged, BOARD_NAMESPACE).run();
    return Response.json({ task: merged, tasks: await readTasks(BOARD_NAMESPACE) });
  }

  return Response.json({ error: "Unsupported action" }, { status: 400 });
}
