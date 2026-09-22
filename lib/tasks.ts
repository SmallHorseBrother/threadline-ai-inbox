export type TaskStatus =
  | "inbox"
  | "mine"
  | "running"
  | "waiting"
  | "suggested"
  | "reference"
  | "archived"
  | "done";

export type TaskPriority = "high" | "medium" | "low";

export type Task = {
  id: string;
  sourceThreadId: string | null;
  sourceKind: "codex" | "chatgpt" | "manual";
  accountAlias: string;
  title: string;
  summary: string;
  nextAction: string;
  status: TaskStatus;
  priority: TaskPriority;
  project: string;
  device: string;
  hostOnline: boolean;
  unread: boolean;
  score: number;
  reason: string;
  dueAt: string | null;
  snoozedUntil: string | null;
  lastActivityAt: string;
  createdAt: string;
  completedAt: string | null;
  tags: string[];
  version?: number;
  manualOverride?: boolean;
  updatedAt?: string;
};

export const statusMeta: Record<
  TaskStatus,
  { label: string; description: string }
> = {
  inbox: { label: "收件箱", description: "新识别的任务，等待确认" },
  mine: { label: "待我处理", description: "下一步需要你的回复、选择或行动" },
  running: { label: "AI 处理中", description: "Codex 或 ChatGPT 任务仍在运行或等待已安排的执行" },
  waiting: { label: "等待中", description: "下一步取决于外部人员、日期、服务或设备" },
  suggested: { label: "建议继续", description: "当前可以继续，而且现在推进比较合适" },
  reference: { label: "资料库", description: "已经没有待办，但仍包含可复用的结论、代码或背景" },
  archived: { label: "低价值归档", description: "测试、重复、被替代或没有可执行目标的历史记录" },
  done: { label: "已完成", description: "目标已经交付或由你确认结束" },
};

export const attentionStatuses = new Set<TaskStatus>([
  "inbox",
  "mine",
  "running",
  "waiting",
  "suggested",
]);

export function isAttentionTask(task: Pick<Task, "status">): boolean {
  return attentionStatuses.has(task.status);
}

const hoursAgo = (hours: number) =>
  new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

const daysFromNow = (days: number) =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

export function createSeedTasks(): Task[] {
  const createdAt = hoursAgo(72);
  return [
    {
      id: "demo-release-plan",
      sourceThreadId: null,
      sourceKind: "codex",
      accountAlias: "账号1",
      title: "确认移动端发布方案",
      summary: "Codex 已整理两个发布路径，等待选择灰度发布还是一次性上线。",
      nextAction: "选择发布路径并确认发布时间",
      status: "mine",
      priority: "high",
      project: "示例产品",
      device: "开发电脑",
      hostOnline: true,
      unread: true,
      score: 94,
      reason: "有未读结果 · 等你决策",
      dueAt: daysFromNow(1),
      snoozedUntil: null,
      lastActivityAt: hoursAgo(1),
      createdAt,
      completedAt: null,
      tags: ["演示", "发布"],
    },
    {
      id: "demo-data-cleanup",
      sourceThreadId: null,
      sourceKind: "codex",
      accountAlias: "账号2",
      title: "清洗客户反馈数据",
      summary: "后台正在去重并聚类最近一批客户反馈。",
      nextAction: "等待处理完成后审阅高频问题",
      status: "running",
      priority: "medium",
      project: "示例研究",
      device: "研究电脑",
      hostOnline: true,
      unread: false,
      score: 82,
      reason: "长任务 · 正在稳定运行",
      dueAt: null,
      snoozedUntil: null,
      lastActivityAt: hoursAgo(0.4),
      createdAt,
      completedAt: null,
      tags: ["演示", "数据"],
    },
    {
      id: "demo-pricing-research",
      sourceThreadId: null,
      sourceKind: "chatgpt",
      accountAlias: "账号1",
      title: "完善产品定价调研",
      summary: "已有竞品价格区间，还缺少目标用户访谈结论。",
      nextAction: "补充三位目标用户的付费意愿",
      status: "suggested",
      priority: "medium",
      project: "示例产品",
      device: "ChatGPT 网页",
      hostOnline: true,
      unread: false,
      score: 76,
      reason: "目标明确 · 停滞三天",
      dueAt: daysFromNow(3),
      snoozedUntil: null,
      lastActivityAt: hoursAgo(76),
      createdAt,
      completedAt: null,
      tags: ["演示", "调研"],
    },
    {
      id: "demo-external-review",
      sourceThreadId: null,
      sourceKind: "manual",
      accountAlias: "账号1",
      title: "等待设计稿评审",
      summary: "设计稿已提交，下一步取决于外部评审意见。",
      nextAction: "收到评审意见后更新任务状态",
      status: "waiting",
      priority: "low",
      project: "示例产品",
      device: "手工任务",
      hostOnline: true,
      unread: false,
      score: 44,
      reason: "等待外部反馈",
      dueAt: null,
      snoozedUntil: null,
      lastActivityAt: hoursAgo(48),
      createdAt,
      completedAt: null,
      tags: ["演示", "设计"],
    },
    {
      id: "demo-onboarding",
      sourceThreadId: null,
      sourceKind: "chatgpt",
      accountAlias: "账号2",
      title: "整理新用户引导文案",
      summary: "已生成初稿，需要确认语气和信息层级。",
      nextAction: "审阅首屏文案并选择推荐版本",
      status: "inbox",
      priority: "medium",
      project: "示例增长",
      device: "ChatGPT 网页",
      hostOnline: true,
      unread: true,
      score: 70,
      reason: "新收录 · 尚未确认",
      dueAt: null,
      snoozedUntil: null,
      lastActivityAt: hoursAgo(5),
      createdAt,
      completedAt: null,
      tags: ["演示", "文案"],
    },
    {
      id: "demo-completed",
      sourceThreadId: null,
      sourceKind: "codex",
      accountAlias: "账号1",
      title: "修复登录页移动端布局",
      summary: "布局问题已修复并通过浏览器回归测试。",
      nextAction: "无需操作",
      status: "done",
      priority: "low",
      project: "示例产品",
      device: "开发电脑",
      hostOnline: false,
      unread: false,
      score: 0,
      reason: "已验证完成",
      dueAt: null,
      snoozedUntil: null,
      lastActivityAt: hoursAgo(96),
      createdAt,
      completedAt: hoursAgo(90),
      tags: ["演示", "已完成"],
    },
  ];
}

export function getRelativeTime(iso: string): string {
  const delta = Math.max(0, Date.now() - new Date(iso).getTime());
  const minutes = Math.floor(delta / 60000);
  if (minutes < 2) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

export function taskScore(task: Task): number {
  if (!isAttentionTask(task)) return 0;
  const ageDays = (Date.now() - new Date(task.lastActivityAt).getTime()) / 86400000;
  const recencyAdjustment = ageDays <= 2 ? 4 : ageDays <= 7 ? 0 : ageDays <= 14 ? -4 : ageDays <= 30 ? -10 : -18;
  const statusBoost = task.status === "mine" ? 12
    : task.status === "running" ? 6
      : task.status === "suggested" ? 4
        : task.status === "inbox" ? 2
          : -14;
  const unreadBoost = task.unread ? 14 : 0;
  const priorityBoost = task.priority === "high" ? 10 : task.priority === "low" ? -8 : 0;
  let dueBoost = 0;
  if (task.dueAt) {
    const dueDays = (new Date(task.dueAt).getTime() - Date.now()) / 86400000;
    dueBoost = dueDays < 0 ? 18 : dueDays <= 1 ? 14 : dueDays <= 3 ? 8 : 0;
  }
  const protectedBoost = task.tags.includes("永不归档") ? 4 : 0;
  return Math.max(0, Math.min(100, task.score + recencyAdjustment + statusBoost + unreadBoost + priorityBoost + dueBoost + protectedBoost));
}

function isOldNonUrgent(task: Task) {
  const ageDays = (Date.now() - new Date(task.lastActivityAt).getTime()) / 86400000;
  return ageDays > 14 && !task.unread && task.priority !== "high" && !task.dueAt;
}

export function selectPriorityTasks(tasks: Task[], limit = 3): Task[] {
  const ranked = tasks
    .filter(isAttentionTask)
    .sort((a, b) => taskScore(b) - taskScore(a) || new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime());
  const selected: Task[] = [];
  const projectCounts = new Map<string, number>();
  let oldNonUrgentCount = 0;
  for (const task of ranked) {
    if (selected.length >= limit) break;
    const project = task.project.trim() || "未分类";
    if ((projectCounts.get(project) ?? 0) >= 2) continue;
    const oldNonUrgent = isOldNonUrgent(task);
    if (oldNonUrgent && oldNonUrgentCount >= 1) continue;
    selected.push(task);
    projectCounts.set(project, (projectCounts.get(project) ?? 0) + 1);
    if (oldNonUrgent) oldNonUrgentCount += 1;
  }
  return selected;
}
