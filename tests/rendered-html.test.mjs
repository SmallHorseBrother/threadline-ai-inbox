import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { Script } from "node:vm";

const root = new URL("../", import.meta.url);

test("defines the complete Threadline task dashboard", async () => {
  const [page, taskboard, layout] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/taskboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(page, /<Taskboard \/>/);
  assert.match(taskboard, /Threadline/);
  assert.match(taskboard, /AI 工作驾驶舱/);
  assert.match(taskboard, /只看需要你拍板的事/);
  assert.match(taskboard, /全部电脑/);
  assert.match(taskboard, /全部来源/);
  assert.match(taskboard, /DeviceScopeBar/);
  assert.match(taskboard, /状态看板/);
  assert.match(taskboard, /任务控制台/);
  assert.match(taskboard, /资料库/);
  assert.match(taskboard, /低价值归档/);
  assert.match(taskboard, /永不归档/);
  assert.match(taskboard, /同步与提醒/);
  assert.match(taskboard, /全部账号/);
  assert.match(taskboard, /两个 Pro 账号，统一排序/);
  assert.match(taskboard, /导入 ChatGPT 历史/);
  assert.match(taskboard, /ChatGPT 云对话/);
  assert.match(taskboard, /codex:\/\/threads\//);
  assert.ok(taskboard.includes("(?:c|share)"));
  assert.doesNotMatch(taskboard, /codex:\/\/thread\//);
  assert.match(taskboard, /const intervention =/);
  assert.doesNotMatch(taskboard, /\bstale\.length\b|\bstale\.map\b/);
  assert.match(layout, /og\.png/);
  assert.doesNotMatch(page + taskboard + layout, /codex-preview/);
  assert.doesNotMatch(page + taskboard + layout, /Your site is taking shape/);
});

test("ships persistence, privacy-safe sync, and deployment metadata", async () => {
  const [hosting, api, syncApi, deviceApi, chatgptApi, lifecycleApi, chatgptParser, summaryApi, siteAuth, taskStore, taskAnalysis, executiveSummary, tasksSource, scanner, taskboard, packageJson, css] = await Promise.all([
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
    readFile(new URL("../app/api/tasks/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/device-sync/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/devices/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/chatgpt-import/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/lifecycle-review/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/chatgpt-import.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/executive-summary/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/server/site-auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/server/task-store.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/server/task-analysis.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/server/executive-summary.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/tasks.ts", import.meta.url), "utf8"),
    readFile(new URL("../tools/thread-sync/codex_task_sync.py", import.meta.url), "utf8"),
    readFile(new URL("../app/taskboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(hosting, /project_id|appgprj_/);
  assert.match(hosting, /"d1": "DB"/);
  assert.match(siteAuth, /oai-authenticated-user-id/);
  assert.match(siteAuth, /oai-authenticated-user-email/);
  assert.match(siteAuth, /local-preview/);
  assert.match(api, /byAccountAndSourceThread/);
  assert.match(taskStore, /account_alias/);
  assert.match(api, /keepManualState/);
  assert.match(scanner, /mode=ro/);
  assert.match(scanner, /includes_message_bodies/);
  assert.match(scanner, /sanitize_analysis_text/);
  assert.match(scanner, /includes_tool_arguments_or_outputs[^\n]+False/);
  assert.doesNotMatch(api + syncApi + deviceApi + summaryApi, /CREATE TABLE IF NOT EXISTS/);
  assert.match(syncApi, /X-Threadline-Device-Token|x-threadline-device-token/);
  assert.match(syncApi, /task_source_presence/);
  assert.match(deviceApi, /THREADLINE_SITES_BYPASS_TOKEN/);
  assert.match(scanner, /OAI-Sites-Authorization/);
  assert.match(scanner, /X-Threadline-Device-Token/);
  assert.match(scanner, /utf-8-sig/);
  assert.match(syncApi, /analyzeChangedTasks/);
  assert.match(chatgptApi, /analyzeChangedTasks/);
  assert.match(chatgptApi, /sourceKind: "chatgpt"/);
  assert.match(chatgptParser, /current_node/);
  assert.match(chatgptParser, /extractTurns/);
  assert.match(chatgptParser, /slice\(-4\)/);
  assert.match(taskAnalysis, /THREADLINE_ANALYSIS_API_KEY/);
  assert.match(taskAnalysis, /conversation_excerpt/);
  assert.match(taskAnalysis, /MAX_NEW_ANALYSES_PER_SYNC = 24/);
  assert.match(taskAnalysis, /attention-lifecycle-v3/);
  assert.match(taskAnalysis, /slice\(0, 2\)/);
  assert.match(taskAnalysis, /slice\(-6\)/);
  assert.match(taskAnalysis, /时间久绝不是 archive 的理由/);
  assert.match(lifecycleApi, /confidence >= 0\.93/);
  assert.match(lifecycleApi, /永不归档/);
  assert.match(taskAnalysis, /Promise\.allSettled/);
  assert.match(executiveSummary, /领导驾驶舱的首席助理/);
  assert.match(executiveSummary, /executive_summary_cache/);
  assert.match(executiveSummary, /ranking_score/);
  assert.match(executiveSummary, /同一项目最多推荐 2 项/);
  assert.match(tasksSource, /recencyAdjustment/);
  assert.match(tasksSource, /selectPriorityTasks/);
  assert.match(tasksSource, /projectCounts/);
  assert.doesNotMatch(tasksSource, /staleBoost/);
  assert.match(scanner, /ANALYSIS_CONTEXT_ROTATING_LIMIT = 18/);
  assert.match(scanner, /AGENT_VERSION = "2\.2\.0"/);
  assert.doesNotMatch(taskAnalysis, /sk-[a-z0-9]{16}/i);
  assert.match(taskboard, /new Blob\(\["\\ufeff", content\]/);
  assert.match(taskboard, /agentVersion: 'chatgpt-web-1\.2'/);
  assert.match(taskboard, /一键回填历史/);
  assert.match(taskboard, /backend-api\/conversations/);
  assert.match(taskboard, /history_backfill/);
  assert.match(taskboard, /GM_registerMenuCommand/);
  assert.match(taskboard, /data-threadline-close/);
  assert.match(taskboard, /PANEL_HIDDEN_KEY/);
  assert.match(syncApi, /snapshotId/);
  assert.match(syncApi, /body\.complete !== false/);
  assert.match(taskboard, /lastHeartbeatAt/);
  assert.match(taskboard, /!isChatGPTWebDevice\(device\) && !supportsSemanticSync/);
  assert.match(packageJson, /"threadline-ai-inbox"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.match(css, /prefers-reduced-motion/);
  await access(new URL("../public/og.png", import.meta.url));
  await access(new URL("../public/agent/codex_task_sync.py", import.meta.url));
  await access(new URL("../drizzle/0000_fuzzy_titanium_man.sql", import.meta.url));
  await access(new URL("../drizzle/0001_curious_hammerhead.sql", import.meta.url));
  await access(new URL("../drizzle/0002_exotic_stepford_cuckoos.sql", import.meta.url));
  await access(new URL("../drizzle/0003_mighty_rhino.sql", import.meta.url));
  await access(new URL("../drizzle/0004_previous_franklin_storm.sql", import.meta.url));
  await access(new URL("../drizzle/0005_neat_thunderball.sql", import.meta.url));
  await access(new URL("../drizzle/0006_watery_titanium_man.sql", import.meta.url));
  await access(new URL("../tools/thread-sync/snapshot.schema.json", import.meta.url));
  await access(new URL("../tools/thread-sync/render_board.py", import.meta.url));
  await access(root);
});

test("generated ChatGPT history connector is valid JavaScript", async () => {
  const taskboard = await readFile(new URL("../app/taskboard.tsx", import.meta.url), "utf8");
  const marker = "return String.raw`// ==UserScript==";
  const start = taskboard.indexOf(marker);
  assert.notEqual(start, -1);
  const bodyStart = start + "return String.raw`".length;
  const tail = taskboard.slice(bodyStart);
  const endMarker = tail.match(/\r?\n`;\r?\n}/);
  assert.ok(endMarker && typeof endMarker.index === "number");
  const end = bodyStart + endMarker.index;
  const connector = taskboard
    .slice(bodyStart, end)
    .replaceAll("${account}", "账号测试")
    .replaceAll("${host}", "threadline.example")
    .replaceAll("${JSON.stringify(site)}", JSON.stringify("https://threadline.example"))
    .replaceAll("${JSON.stringify(pairing.device_id)}", JSON.stringify("device-test"))
    .replaceAll("${JSON.stringify(pairing.device_name)}", JSON.stringify("ChatGPT 网页 · 账号测试"))
    .replaceAll("${JSON.stringify(pairing.device_token)}", JSON.stringify("device-token-test"))
    .replaceAll("${JSON.stringify(pairing.sites_authorization)}", JSON.stringify("site-token-test"))
    .replaceAll("${JSON.stringify(account)}", JSON.stringify("账号测试"));
  new Script(connector);
});
