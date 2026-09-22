"use client";

import {
  Activity,
  Archive,
  ArrowRight,
  Bell,
  BookOpen,
  BrainCircuit,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Cloud,
  Columns3,
  Command,
  Download,
  FileJson,
  Filter,
  Globe2,
  Inbox,
  LayoutList,
  LoaderCircle,
  Menu,
  MessageSquareText,
  Monitor,
  MoreHorizontal,
  Pause,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Table2,
  TimerReset,
  Upload,
  UserRound,
  Wifi,
  X,
  Zap,
} from "lucide-react";
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  createSeedTasks,
  getRelativeTime,
  isAttentionTask,
  selectPriorityTasks,
  statusMeta,
  taskScore,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/tasks";
import { parseChatGPTExport } from "@/lib/chatgpt-import";
import { normalizeSnapshotTasks } from "@/lib/snapshot-task";

type View = "today" | "board" | "console" | "library" | "completed" | "archive" | "sync";

type DeviceSource = {
  id: string;
  deviceName: string;
  accountAlias: string;
  createdAt: string;
  lastSeenAt: string | null;
  lastSyncAt: string | null;
  agentVersion: string | null;
  recordCount: number;
  revokedAt: string | null;
};

type ExecutiveSummary = {
  summary: string;
  actions: string[];
  generatedAt: string;
  source: "deepseek" | "rules";
};

type LifecycleProgress = {
  reviewed: number;
  remaining: number;
  archived: number;
  referenced: number;
  paused?: boolean;
};

type PairingConfig = {
  version: 1;
  site_url: string;
  upload_path: string;
  agent_path: string;
  sites_authorization: string;
  device_token: string;
  device_id: string;
  device_name: string;
  account_alias: string;
};

type SourceScope = "all" | Task["sourceKind"];

const statusOrder: TaskStatus[] = ["mine", "running", "suggested", "waiting", "inbox", "reference", "archived", "done"];

const statusIcons: Record<TaskStatus, typeof Inbox> = {
  inbox: Inbox,
  mine: UserRound,
  running: LoaderCircle,
  waiting: Pause,
  suggested: Sparkles,
  reference: BookOpen,
  archived: Archive,
  done: CheckCircle2,
};

const navItems: { id: View; label: string; icon: typeof Inbox }[] = [
  { id: "today", label: "今天", icon: Sparkles },
  { id: "board", label: "状态看板", icon: Columns3 },
  { id: "console", label: "任务控制台", icon: Table2 },
  { id: "library", label: "资料库", icon: BookOpen },
  { id: "completed", label: "已完成", icon: CheckCircle2 },
  { id: "archive", label: "低价值归档", icon: Archive },
  { id: "sync", label: "同步与提醒", icon: Cloud },
];

const taskAccount = (task: Pick<Task, "accountAlias">) => task.accountAlias?.trim() || "账号1";

const taskDevices = (task: Pick<Task, "device">) =>
  task.device.split("、").map((name) => name.trim()).filter(Boolean);

const taskMatchesDevice = (task: Pick<Task, "device">, selected: string) =>
  selected === "全部电脑" || task.device === "任意设备" || taskDevices(task).includes(selected);

const sourceLabels: Record<SourceScope, string> = {
  all: "全部来源",
  codex: "Codex",
  chatgpt: "ChatGPT",
  manual: "手工任务",
};

type ChatGPTTarget = {
  url: string;
  kind: "original" | "shared";
};

function getChatGPTTarget(sourceThreadId: string): ChatGPTTarget | null {
  const raw = sourceThreadId.trim();
  if (!raw) return null;

  const embeddedUrl = raw.match(/https:\/\/(?:chatgpt\.com|chat\.openai\.com)\/(?:c|share)\/[^\s)\]]+/i)?.[0];
  const candidate = embeddedUrl || raw;
  try {
    const parsed = new URL(candidate);
    if (!["chatgpt.com", "chat.openai.com"].includes(parsed.hostname.toLowerCase())) return null;
    const match = parsed.pathname.match(/^\/(c|share)\/([^/?#]+)/i);
    if (!match) return null;
    return {
      url: `https://chatgpt.com/${match[1].toLowerCase()}/${encodeURIComponent(match[2])}`,
      kind: match[1].toLowerCase() === "share" ? "shared" : "original",
    };
  } catch {
    if (!/^[0-9a-z-]{12,}$/i.test(raw)) return null;
    return { url: `https://chatgpt.com/c/${encodeURIComponent(raw)}`, kind: "original" };
  }
}

const continueButtonLabel = (task: Task) => {
  if (task.sourceKind === "chatgpt") return `用${taskAccount(task)}继续`;
  if (task.sourceKind === "codex") return "打开 Codex 任务";
  return "打开原任务";
};

const supportsSemanticSync = (version: string | null) => {
  if (!version) return false;
  if (version.startsWith("chatgpt-web-")) return true;
  const [major = 0, minor = 0] = version.split(".").map(Number);
  return major > 2 || (major === 2 && minor >= 2);
};

const isChatGPTWebDevice = (device: Pick<DeviceSource, "deviceName" | "agentVersion">) =>
  device.deviceName.startsWith("ChatGPT 网页 ·") || device.agentVersion?.startsWith("chatgpt-web-") === true;

function utf8Base64(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function buildCloudInstaller(pairing: PairingConfig) {
  const pairingBase64 = utf8Base64(JSON.stringify(pairing));
  return [
    "# Threadline cloud sync installer",
    "[CmdletBinding()]",
    "param(",
    "  [ValidateRange(5, 1440)]",
    "  [int]$IntervalMinutes = 15,",
    "  [switch]$RedactTitles",
    ")",
    "",
    '$ErrorActionPreference = "Stop"',
    `$pairingJson = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("${pairingBase64}"))`,
    "$pairing = $pairingJson | ConvertFrom-Json",
    "$python = Get-Command python -ErrorAction Stop",
    '$installRoot = Join-Path $env:LOCALAPPDATA ("Threadline\\Agent\\" + $pairing.device_id)',
    "$agentPath = Join-Path $installRoot 'codex_task_sync.py'",
    "$configPath = Join-Path $installRoot 'device.json'",
    "$snapshotPath = Join-Path $installRoot 'last-snapshot.json'",
    "$runnerPath = Join-Path $installRoot 'run-threadline-cloud-sync.ps1'",
    "New-Item -ItemType Directory -Path $installRoot -Force | Out-Null",
    "$pairingJson | Set-Content -LiteralPath $configPath -Encoding utf8",
    "$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name",
    "$grant = $identity + ':(OI)(CI)F'",
    "& icacls.exe $installRoot /inheritance:r /grant:r $grant | Out-Null",
    "$agentUri = $pairing.site_url.TrimEnd('/') + $pairing.agent_path",
    "$headers = @{}",
    "if ($pairing.sites_authorization) { $headers['OAI-Sites-Authorization'] = $pairing.sites_authorization }",
    "try {",
    "  Invoke-WebRequest -Uri $agentUri -Headers $headers -OutFile $agentPath -UseBasicParsing",
    "} catch {",
    "  if (-not $pairing.sites_authorization) { throw }",
    "  $headers['OAI-Sites-Authorization'] = 'Bearer ' + $pairing.sites_authorization",
    "  Invoke-WebRequest -Uri $agentUri -Headers $headers -OutFile $agentPath -UseBasicParsing",
    "}",
    '$commandLine = "& `"$($python.Source)`" `"$agentPath`" sync --config `"$configPath`" --output `"$snapshotPath`""',
    "if ($RedactTitles) { $commandLine += ' --redact-titles' }",
    '$runnerLines = @(\'$ErrorActionPreference = "Stop"\', $commandLine, \'exit $LASTEXITCODE\')',
    "$runnerLines | Set-Content -LiteralPath $runnerPath -Encoding utf8",
    '$taskName = "Threadline Cloud Sync - " + $pairing.device_id',
    '$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ("-NoProfile -ExecutionPolicy Bypass -File `"" + $runnerPath + "`"")',
    "$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) -RepetitionDuration (New-TimeSpan -Days 3650)",
    "$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew",
    'Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "Read-only Codex metadata scan and direct Threadline cloud sync." -Force | Out-Null',
    "& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $runnerPath",
    "if ($LASTEXITCODE -ne 0) { throw 'Initial Threadline synchronization failed.' }",
    'Write-Host "Threadline 已连接：$($pairing.device_name) / $($pairing.account_alias)" -ForegroundColor Green',
    'Write-Host "此后每 $IntervalMinutes 分钟自动同步；可以删除刚刚下载的安装脚本。"',
    "",
  ].join("\r\n");
}

function buildAnalyzerUpgrade() {
  return [
    "# Threadline semantic analysis collector upgrade",
    "[CmdletBinding()]",
    "param()",
    "",
    '$ErrorActionPreference = "Stop"',
    "$agentRoot = Join-Path $env:LOCALAPPDATA 'Threadline\\Agent'",
    "if (-not (Test-Path -LiteralPath $agentRoot)) { throw 'No Threadline device installation was found on this computer.' }",
    "$configs = @(Get-ChildItem -LiteralPath $agentRoot -Filter 'device.json' -File -Recurse)",
    "if (-not $configs.Count) { throw 'No Threadline device configuration was found on this computer.' }",
    "foreach ($configFile in $configs) {",
    "  $pairing = Get-Content -LiteralPath $configFile.FullName -Raw -Encoding UTF8 | ConvertFrom-Json",
    "  $agentPath = Join-Path $configFile.DirectoryName 'codex_task_sync.py'",
    "  $runnerPath = Join-Path $configFile.DirectoryName 'run-threadline-cloud-sync.ps1'",
    "  $agentUri = $pairing.site_url.TrimEnd('/') + $pairing.agent_path",
    "  $headers = @{}",
    "  if ($pairing.sites_authorization) { $headers['OAI-Sites-Authorization'] = $pairing.sites_authorization }",
    "  try {",
    "    Invoke-WebRequest -Uri $agentUri -Headers $headers -OutFile $agentPath -UseBasicParsing",
    "  } catch {",
    "    if (-not $pairing.sites_authorization) { throw }",
    "    $headers['OAI-Sites-Authorization'] = 'Bearer ' + $pairing.sites_authorization",
    "    Invoke-WebRequest -Uri $agentUri -Headers $headers -OutFile $agentPath -UseBasicParsing",
    "  }",
    "  if (Test-Path -LiteralPath $runnerPath) {",
    "    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $runnerPath",
    "    if ($LASTEXITCODE -ne 0) { throw 'Threadline first semantic sync failed.' }",
    "  }",
    "}",
    'Write-Host "Threadline 智能判断采集器已升级，并已完成首次同步。" -ForegroundColor Green',
    "",
  ].join("\r\n");
}

function buildChatGPTConnector(pairing: PairingConfig) {
  const site = pairing.site_url.replace(/\/+$/, "");
  const host = new URL(site).host;
  const account = pairing.account_alias;
  return String.raw`// ==UserScript==
// @name         Threadline ChatGPT 云连接器 - ${account}
// @namespace    https://threadline.local/
// @version      1.2.2
// @description  实时同步 ChatGPT 对话，并支持一键全量回填历史
// @match        https://chatgpt.com/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      ${host}
// @noframes
// ==/UserScript==

(() => {
  'use strict';
  if (window.top !== window.self) return;
  const SITE = ${JSON.stringify(site)};
  const DEVICE_ID = ${JSON.stringify(pairing.device_id)};
  const DEVICE_NAME = ${JSON.stringify(pairing.device_name)};
  const DEVICE_TOKEN = ${JSON.stringify(pairing.device_token)};
  const SITE_TOKEN = ${JSON.stringify(pairing.sites_authorization)};
  const ACCOUNT = ${JSON.stringify(account)};
  const LIVE_KEY = 'threadline.chatgpt.live.v2.' + ACCOUNT;
  const BACKFILL_KEY = 'threadline.chatgpt.backfill.v2.' + ACCOUNT;
  const PANEL_ID = 'threadline-history-backfill';
  const BATCH_SIZE = 10;
  const MAX_CONVERSATIONS = 5000;
  let lastHeartbeatAt = 0;
  let timer = 0;
  let backfillRunning = false;
  let pauseRequested = false;
  let chatSessionLoaded = false;
  let chatAccessToken = '';
  let hiddenPageUnavailable = false;
  const pageFetch = typeof unsafeWindow !== 'undefined' && typeof unsafeWindow.fetch === 'function'
    ? unsafeWindow.fetch.bind(unsafeWindow)
    : window.fetch.bind(window);

  const clean = (value, limit = 1800) => String(value || '')
    .replace(new RegExp(String.fromCharCode(96).repeat(3) + '[\\s\\S]*?' + String.fromCharCode(96).repeat(3), 'g'), '[代码块已省略]')
    .replace(/\bsk-[a-z0-9_-]{12,}\b/gi, '[密钥已删除]')
    .replace(/[A-Z]:\\Users\\[^\s]+/gi, '[本地路径已删除]')
    .replace(/\s+/g, ' ').trim().slice(0, limit);

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const readJson = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key) || '') || fallback; }
    catch { return fallback; }
  };
  const writeJson = (key, value) => localStorage.setItem(key, JSON.stringify(value));

  async function sha256(value) {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function toIso(value, fallback) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return new Date(value < 100000000000 ? value * 1000 : value).toISOString();
    }
    if (typeof value === 'string' && value) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    }
    return fallback;
  }

  function conversationId() {
    const match = location.pathname.match(/(?:^|\/)c\/([0-9a-z-]{12,})(?:\/|$)/i);
    return match ? match[1] : '';
  }

  function collectVisibleTurns() {
    const roleNodes = Array.from(document.querySelectorAll('[data-message-author-role]'));
    if (roleNodes.length) {
      return roleNodes
        .map(node => ({ role: node.getAttribute('data-message-author-role'), text: clean(node.textContent) }))
        .filter(turn => (turn.role === 'user' || turn.role === 'assistant') && turn.text);
    }
    return Array.from(document.querySelectorAll('article, [data-testid^="conversation-turn-"]'))
      .map(node => {
        const label = clean(node.querySelector('h5, [class*="sr-only"]')?.textContent, 80).toLowerCase();
        const role = /you said|你说|user/.test(label) ? 'user' : 'assistant';
        const content = node.querySelector('.markdown, [data-message-content], [class*="whitespace-pre-wrap"]') || node;
        return { role, text: clean(content.textContent) };
      })
      .filter(turn => turn.text);
  }

  function messageText(message) {
    const content = message?.content;
    if (typeof content === 'string') return clean(content);
    if (typeof message?.text === 'string') return clean(message.text);
    const parts = Array.isArray(content?.parts) ? content.parts : [];
    return clean(parts.map(part => {
      if (typeof part === 'string') return part;
      if (part && typeof part === 'object') return part.text || part.content || '';
      return '';
    }).join('\n'));
  }

  function detailTurns(detail) {
    if (Array.isArray(detail?.__threadline_turns)) return detail.__threadline_turns;
    const root = [detail, detail?.conversation, detail?.data, detail?.data?.conversation, detail?.result]
      .find(value => value && typeof value === 'object' && (value.mapping || value.messages || value.nodes)) || detail;
    const mapping = root?.mapping && typeof root.mapping === 'object' ? root.mapping : {};
    const turns = [];
    const visited = new Set();
    let nodeId = root?.current_node;
    while (nodeId && mapping[nodeId] && !visited.has(nodeId)) {
      visited.add(nodeId);
      const node = mapping[nodeId];
      const role = node?.message?.author?.role;
      const text = messageText(node?.message);
      if ((role === 'user' || role === 'assistant') && text) turns.push({ role, text });
      nodeId = node?.parent;
    }
    if (turns.length) return turns.reverse();
    const mapped = Object.values(mapping)
      .map(node => ({
        role: node?.message?.author?.role,
        text: messageText(node?.message),
        at: Number(node?.message?.create_time || 0),
      }))
      .filter(turn => (turn.role === 'user' || turn.role === 'assistant') && turn.text)
      .sort((a, b) => a.at - b.at)
      .map(({ role, text }) => ({ role, text }));
    if (mapped.length) return mapped;
    const messages = Array.isArray(root?.messages) ? root.messages : Array.isArray(root?.nodes) ? root.nodes : [];
    return messages
      .map(item => item?.message || item)
      .map(message => ({ role: message?.author?.role || message?.role, text: messageText(message), at: Number(message?.create_time || message?.created_at || 0) }))
      .filter(turn => (turn.role === 'user' || turn.role === 'assistant') && turn.text)
      .sort((a, b) => a.at - b.at)
      .map(({ role, text }) => ({ role, text }));
  }

  function evidenceTurns(turns) {
    if (turns.length <= 12) return turns;
    const firstUser = turns.find(turn => turn.role === 'user');
    const recent = turns.slice(-11);
    return firstUser && !recent.includes(firstUser) ? [firstUser, ...recent] : turns.slice(-12);
  }

  async function buildRecord(info, turns, source) {
    if (!info?.id || !turns.length) return null;
    const now = new Date().toISOString();
    const evidence = evidenceTurns(turns);
    const fingerprint = await sha256(JSON.stringify(evidence));
    const last = turns[turns.length - 1];
    const latestAssistant = [...turns].reverse().find(turn => turn.role === 'assistant');
    const title = clean(info.title, 240) || clean(turns.find(turn => turn.role === 'user')?.text, 80) || '未命名 ChatGPT 对话';
    return {
      task_id: 'chatgpt:' + ACCOUNT + ':' + info.id,
      thread_id: info.id,
      account_alias: ACCOUNT,
      source_kind: 'chatgpt',
      title,
      summary: clean(latestAssistant?.text || '从 ChatGPT 网页同步。', 320),
      status: last.role === 'assistant' ? 'needs_attention' : 'in_progress',
      status_confidence: 'medium',
      status_basis: ['ChatGPT 历史回填：首轮与最近对话片段'],
      attention_score: last.role === 'assistant' ? 78 : 68,
      recommended_action: last.role === 'assistant' ? 'review_required_input' : 'continue_thread',
      created_at: toIso(info.create_time, now),
      updated_at: toIso(info.update_time, now),
      device_ids: [DEVICE_NAME],
      analysis_context: { version: 2, fingerprint, turns: evidence, total_turns: turns.length, source },
    };
  }

  function send(body) {
    return new Promise((resolve, reject) => GM_xmlhttpRequest({
      method: 'POST',
      url: SITE + '/api/device-sync',
      headers: {
        'Content-Type': 'application/json',
        'x-threadline-device-token': DEVICE_TOKEN,
        ...(SITE_TOKEN ? { 'OAI-Sites-Authorization': 'Bearer ' + SITE_TOKEN } : {}),
      },
      data: JSON.stringify(body),
      timeout: 60000,
      onload: response => {
        if (response.status >= 200 && response.status < 300) resolve(response);
        else reject(new Error('Threadline upload HTTP ' + response.status));
      },
      onerror: () => reject(new Error('Threadline upload network error')),
      ontimeout: () => reject(new Error('Threadline upload timeout')),
    }));
  }

  async function upload(records, options = {}) {
    const now = new Date().toISOString();
    const scanId = 'chatgpt-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    await send({
      scanId,
      snapshotId: options.snapshotId || scanId,
      complete: options.complete === true,
      agentVersion: 'chatgpt-web-1.2',
      snapshot: {
        schema_version: 1,
        kind: 'codex_task_snapshot',
        generated_at: now,
        device: { id: DEVICE_ID },
        account: { alias: ACCOUNT },
        tasks: records,
      },
    });
    lastHeartbeatAt = Date.now();
  }

  async function requestJson(url, attempts = 4) {
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        await loadChatSession(attempt > 0);
        const headers = { Accept: 'application/json' };
        if (chatAccessToken) headers.Authorization = 'Bearer ' + chatAccessToken;
        const response = await pageFetch(url, { credentials: 'include', headers });
        if (response.ok) return await response.json();
        const error = new Error('ChatGPT history HTTP ' + response.status);
        error.status = response.status;
        throw error;
      } catch (error) {
        lastError = error;
        if ([401, 403].includes(Number(error?.status))) chatSessionLoaded = false;
        if (![401, 403, 429, 500, 502, 503, 504].includes(Number(error?.status)) || attempt === attempts - 1) throw error;
        await sleep(1200 * Math.pow(2, attempt));
      }
    }
    throw lastError;
  }

  async function loadChatSession(force = false) {
    if (chatSessionLoaded && !force) return;
    chatSessionLoaded = true;
    try {
      const response = await pageFetch('/api/auth/session', { credentials: 'include', headers: { Accept: 'application/json' } });
      if (!response.ok) return;
      const session = await response.json();
      chatAccessToken = String(session?.accessToken || session?.access_token || session?.data?.accessToken || '');
    } catch (error) {
      console.warn('[Threadline] 未能读取 ChatGPT 会话令牌，将继续使用登录 Cookie', error);
    }
  }

  function unpackConversationList(data) {
    const candidates = [
      data?.items,
      data?.conversations,
      data?.results,
      data?.data?.items,
      data?.data?.conversations,
      data?.data?.results,
      Array.isArray(data?.data) ? data.data : null,
      Array.isArray(data) ? data : null,
    ];
    let items = candidates.find(value => Array.isArray(value)) || [];
    if (!items.length) {
      const edges = data?.edges || data?.data?.edges || data?.items?.edges;
      if (Array.isArray(edges)) items = edges.map(edge => edge?.node || edge).filter(Boolean);
    }
    return {
      items: items.map(item => item?.node || item).filter(Boolean),
      total: Number(data?.total ?? data?.total_count ?? data?.count ?? data?.data?.total ?? data?.data?.total_count ?? 0),
      keys: data && typeof data === 'object' ? Object.keys(data).slice(0, 8).join(',') : typeof data,
    };
  }

  async function conversationListPage(offset, archived) {
    const base = '/backend-api/conversations?offset=' + offset + '&order=updated';
    const urls = archived
      ? [base + '&limit=100&is_archived=true', base + '&limit=28&is_archived=true']
      : [base + '&limit=100&is_archived=false', base + '&limit=28&is_archived=false', base + '&limit=28'];
    let last = { items: [], total: 0, keys: '' };
    let lastError;
    for (const url of urls) {
      try {
        const parsed = unpackConversationList(await requestJson(url));
        last = parsed;
        if (parsed.items.length || parsed.total > 0) return parsed;
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError && !last.keys) throw lastError;
    return last;
  }

  function collectSidebarLinks() {
    const found = [];
    const seen = new Set();
    for (const anchor of document.querySelectorAll('a[href*="/c/"]')) {
      const match = String(anchor.getAttribute('href') || '').match(/(?:^|\/)c\/([0-9a-z-]{12,})(?:\/|$)/i);
      if (!match || seen.has(match[1])) continue;
      seen.add(match[1]);
      found.push({ id: match[1], title: clean(anchor.textContent, 240), create_time: null, update_time: null, is_archived: false });
    }
    return found;
  }

  async function discoverSidebarHistory() {
    const collected = new Map();
    const addVisible = () => collectSidebarLinks().forEach(item => collected.set(item.id, item));
    addVisible();
    const containers = Array.from(document.querySelectorAll('nav, aside, div'))
      .filter(node => node.scrollHeight > node.clientHeight + 120 && node.querySelector('a[href*="/c/"]'))
      .sort((a, b) => b.scrollHeight - a.scrollHeight);
    const scroller = containers[0];
    if (!scroller) return [...collected.values()];
    const originalTop = scroller.scrollTop;
    let unchanged = 0;
    let previousCount = collected.size;
    for (let step = 0; step < 180 && collected.size < MAX_CONVERSATIONS; step += 1) {
      scroller.scrollTop = scroller.scrollHeight;
      scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
      await sleep(700);
      addVisible();
      unchanged = collected.size === previousCount ? unchanged + 1 : 0;
      previousCount = collected.size;
      setPanel('目录接口不可用，正在从侧边栏回填：' + collected.size + ' 个', true);
      if (unchanged >= 6) break;
    }
    scroller.scrollTop = originalTop;
    return [...collected.values()];
  }

  async function discoverHistory() {
    const result = [];
    const seen = new Set();
    let activeKeys = '';
    for (const archived of [false, true]) {
      let offset = 0;
      try {
        while (result.length < MAX_CONVERSATIONS) {
          setPanel('正在读取' + (archived ? '已归档' : '普通') + '对话目录：' + result.length + ' 个', true);
          const page = await conversationListPage(offset, archived);
          const items = page.items;
          if (!archived && !activeKeys) activeKeys = page.keys;
          const before = seen.size;
          for (const item of items) {
            const id = item?.id || item?.conversation_id;
            if (!id || seen.has(id)) continue;
            seen.add(id);
            result.push({
              id,
              title: item.title || '',
              create_time: item.create_time,
              update_time: item.update_time,
              is_archived: archived,
            });
          }
          offset += items.length;
          const total = page.total;
          if (!items.length || (total > 0 && offset >= total) || seen.size === before) break;
          await sleep(350);
        }
      } catch (error) {
        if (!archived) throw error;
        console.warn('[Threadline] 已归档对话目录暂不可用，先继续普通历史', error);
      }
    }
    if (!result.length) {
      const sidebar = await discoverSidebarHistory();
      if (sidebar.length) return sidebar;
      throw new Error('历史目录返回空结果' + (activeKeys ? '（返回字段：' + activeKeys + '）' : ''));
    }
    return result;
  }

  async function conversationDetail(id) {
    const encoded = encodeURIComponent(id);
    const urls = [
      '/backend-api/conversation/' + encoded + '?response_in_progress=false',
      '/backend-api/conversation/' + encoded,
      '/backend-api/conversation/' + encoded + '?refresh=true',
    ];
    const reasons = [];
    for (const url of urls) {
      try {
        const detail = await requestJson(url, 2);
        const turns = detailTurns(detail);
        if (turns.length) return detail;
        const keys = detail && typeof detail === 'object' ? Object.keys(detail).slice(0, 8).join(',') : typeof detail;
        reasons.push('无消息字段:' + keys);
      } catch (error) {
        reasons.push(String(error?.message || error));
      }
    }
    if (!hiddenPageUnavailable) {
      try {
        return await conversationFromHiddenPage(id);
      } catch (error) {
        hiddenPageUnavailable = true;
        reasons.push(String(error?.message || error));
      }
    }
    throw new Error('正文读取失败：' + [...new Set(reasons)].slice(0, 3).join('；'));
  }

  function conversationFromHiddenPage(id) {
    return new Promise((resolve, reject) => {
      const frame = document.createElement('iframe');
      frame.setAttribute('aria-hidden', 'true');
      frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1200px;height:900px;opacity:.01;pointer-events:none;';
      let checks = 0;
      const cleanup = () => { clearInterval(poll); clearTimeout(timeout); frame.remove(); };
      const inspect = () => {
        checks += 1;
        try {
          const doc = frame.contentDocument;
          if (!doc) return;
          const roleNodes = Array.from(doc.querySelectorAll('[data-message-author-role]'));
          let turns = roleNodes
            .map(node => ({ role: node.getAttribute('data-message-author-role'), text: clean(node.textContent) }))
            .filter(turn => (turn.role === 'user' || turn.role === 'assistant') && turn.text);
          if (!turns.length) {
            turns = Array.from(doc.querySelectorAll('article, [data-testid^="conversation-turn-"]'))
              .map(node => {
                const label = clean(node.querySelector('h5, [class*="sr-only"]')?.textContent, 80).toLowerCase();
                const role = /you said|你说|user/.test(label) ? 'user' : 'assistant';
                const content = node.querySelector('.markdown, [data-message-content], [class*="whitespace-pre-wrap"]') || node;
                return { role, text: clean(content.textContent) };
              })
              .filter(turn => turn.text);
          }
          if (turns.length) {
            const result = { title: doc.title, __threadline_turns: turns };
            cleanup();
            resolve(result);
          } else if (checks >= 18) {
            cleanup();
            reject(new Error('隐藏页面未渲染消息'));
          }
        } catch (error) {
          cleanup();
          reject(new Error('隐藏页面不可访问'));
        }
      };
      const poll = setInterval(inspect, 800);
      const timeout = setTimeout(() => { cleanup(); reject(new Error('隐藏页面读取超时')); }, 16000);
      frame.src = '/c/' + encodeURIComponent(id);
      document.body.appendChild(frame);
    });
  }

  function ensurePanel() {
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;
    panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.setAttribute('aria-live', 'polite');
    panel.style.cssText = 'position:fixed;right:18px;bottom:82px;z-index:2147483646;width:286px;padding:14px 14px 12px;border:1px solid rgba(255,255,255,.16);border-radius:14px;background:#201b38;color:#fff;box-shadow:0 14px 40px rgba(0,0,0,.28);font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;';
    panel.innerHTML = '<div style="font-weight:750;margin-bottom:5px">Threadline · ' + ACCOUNT + '</div><div data-threadline-status style="color:#d9d5eb;margin-bottom:10px">连接器已运行，可以回填全部历史。</div><button type="button" data-threadline-action style="width:100%;border:0;border-radius:9px;padding:9px 12px;background:#7357ff;color:#fff;font-weight:700;cursor:pointer">一键回填历史</button>';
    panel.querySelector('[data-threadline-action]').addEventListener('click', toggleBackfill);
    document.body.appendChild(panel);
    renderSavedState();
    return panel;
  }

  function setPanel(message, busy = false, label) {
    const panel = ensurePanel();
    const status = panel.querySelector('[data-threadline-status]');
    const button = panel.querySelector('[data-threadline-action]');
    status.textContent = message;
    button.textContent = label || (busy ? '暂停回填' : '一键回填历史');
    button.style.background = busy ? '#d97706' : '#7357ff';
  }

  function renderSavedState() {
    const state = readJson(BACKFILL_KEY, null);
    if (!state) return;
    if (state.status === 'done') setPanel('已完成：' + Number(state.successCount || 0) + ' 个对话已回填。', false, '重新扫描历史');
    else if (state.status === 'paused') setPanel('已暂停：完成 ' + Number(state.successCount || 0) + ' / ' + Number(state.total || 0) + '。', false, '继续回填');
    else if (state.status === 'partial') setPanel('部分完成：还有 ' + Number(state.queue?.length || 0) + ' 个失败项。' + (state.lastFailure ? ' 原因：' + clean(state.lastFailure, 90) : ''), false, '重试失败项');
  }

  async function toggleBackfill() {
    if (backfillRunning) {
      pauseRequested = true;
      setPanel('正在安全暂停，当前批次完成后停止…', true, '正在暂停');
      return;
    }
    runBackfill().catch(error => {
      backfillRunning = false;
      const state = readJson(BACKFILL_KEY, {});
      state.status = 'paused';
      state.error = String(error?.message || error);
      writeJson(BACKFILL_KEY, state);
      setPanel('回填暂停：' + clean(state.error, 90), false, '继续回填');
      console.warn('[Threadline] 历史回填暂停', error);
    });
  }

  async function runBackfill() {
    backfillRunning = true;
    pauseRequested = false;
    let state = readJson(BACKFILL_KEY, null);
    const resumable = state && ['paused', 'partial', 'running'].includes(state.status) && Array.isArray(state.queue) && state.queue.length;
    if (!resumable) {
      setPanel('正在发现历史对话…', true);
      const queue = await discoverHistory();
      if (!queue.length) throw new Error('没有读取到历史目录；请确认当前账号已登录并稍后重试');
      state = {
        version: 2,
        status: 'running',
        snapshotId: 'chatgpt-history-' + Date.now() + '-' + Math.random().toString(36).slice(2),
        queue,
        cursor: 0,
        total: queue.length,
        successCount: 0,
        failedTotal: 0,
      };
      writeJson(BACKFILL_KEY, state);
    } else {
      state.status = 'running';
      writeJson(BACKFILL_KEY, state);
    }

    const failed = [];
    const failureReasons = [];
    while (state.cursor < state.queue.length) {
      if (pauseRequested) {
        state.status = 'paused';
        writeJson(BACKFILL_KEY, state);
        backfillRunning = false;
        setPanel('已暂停：完成 ' + state.successCount + ' / ' + state.total + '。', false, '继续回填');
        return;
      }
      const chunk = state.queue.slice(state.cursor, state.cursor + BATCH_SIZE);
      const records = [];
      for (const item of chunk) {
        try {
          const detail = await conversationDetail(item.id);
          const record = await buildRecord({ ...item, title: detail?.title || item.title, create_time: detail?.create_time || item.create_time, update_time: detail?.update_time || item.update_time }, detailTurns(detail), 'history_backfill');
          if (record) records.push(record);
          else {
            failed.push(item);
            failureReasons.push('对话正文为空');
          }
        } catch (error) {
          failed.push(item);
          failureReasons.push(String(error?.message || error));
          console.warn('[Threadline] 跳过一个暂时读取失败的对话', item.id, error);
        }
        setPanel('回填中：' + Math.min(state.cursor + records.length + failed.length, state.total) + ' / ' + state.total + '，失败 ' + (state.failedTotal + failed.length), true);
        await sleep(650);
      }
      if (records.length) {
        await upload(records, { complete: false, snapshotId: state.snapshotId });
        state.successCount += records.length;
      }
      state.cursor += chunk.length;
      writeJson(BACKFILL_KEY, state);
    }

    if (failed.length) {
      state.status = 'partial';
      state.queue = failed;
      state.cursor = 0;
      state.failedTotal += failed.length;
      state.lastFailure = failureReasons[0] || '';
      writeJson(BACKFILL_KEY, state);
      backfillRunning = false;
      setPanel('部分完成：成功 ' + state.successCount + ' 个，还有 ' + failed.length + ' 个。原因：' + clean(state.lastFailure, 90), false, '重试失败项');
      return;
    }

    await upload([], { complete: true, snapshotId: state.snapshotId });
    state.status = 'done';
    state.queue = [];
    state.cursor = 0;
    state.finishedAt = new Date().toISOString();
    writeJson(BACKFILL_KEY, state);
    backfillRunning = false;
    setPanel('已完成：' + state.successCount + ' 个对话已回填。', false, '重新扫描历史');
  }

  async function captureVisibleConversation() {
    const nowMs = Date.now();
    const id = conversationId();
    const turns = id ? collectVisibleTurns() : [];
    const live = readJson(LIVE_KEY, {});
    let changed = false;
    if (id && turns.length) {
      const evidence = evidenceTurns(turns);
      const fingerprint = await sha256(JSON.stringify(evidence));
      if (live[id]?.fingerprint !== fingerprint) {
        const title = clean(document.title.replace(/\s*[|·-]\s*ChatGPT.*$/i, '').replace(/^ChatGPT\s*[|·-]?\s*/i, ''), 240);
        const record = await buildRecord({ id, title, create_time: live[id]?.createdAt, update_time: nowMs }, turns, 'live_page');
        if (record) {
          await upload([record], { complete: false });
          live[id] = { fingerprint, createdAt: live[id]?.createdAt || record.created_at, updatedAt: record.updated_at };
          const compact = Object.fromEntries(Object.entries(live).sort((a, b) => String(b[1]?.updatedAt).localeCompare(String(a[1]?.updatedAt))).slice(0, 500));
          writeJson(LIVE_KEY, compact);
          changed = true;
        }
      }
    }
    if (!changed && nowMs - lastHeartbeatAt >= 5 * 60 * 1000) await upload([], { complete: false });
  }

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => captureVisibleConversation().catch(error => console.warn('[Threadline] 增量同步失败', error)), 2500);
  };
  ensurePanel();
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  window.addEventListener('popstate', schedule);
  window.addEventListener('focus', schedule);
  setInterval(schedule, 30000);
  schedule();
})();
`;
}

function downloadText(filename: string, content: string, type = "text/plain;charset=utf-8") {
  // Windows PowerShell 5.1 treats UTF-8 files without a BOM as the local ANSI
  // code page. A BOM keeps Chinese status text (and its surrounding quotes)
  // parseable on the Windows version most users launch from File Explorer.
  const url = URL.createObjectURL(new Blob(["\ufeff", content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  window.setTimeout(() => {
    anchor.remove();
    URL.revokeObjectURL(url);
  }, 1000);
}

export function Taskboard() {
  const [tasks, setTasks] = useState<Task[]>(createSeedTasks);
  const [view, setView] = useState<View>("today");
  const [query, setQuery] = useState("");
  const [project, setProject] = useState("全部项目");
  const [account, setAccount] = useState("全部账号");
  const [sourceScope, setSourceScope] = useState<SourceScope>("all");
  const [deviceScope, setDeviceScope] = useState("全部电脑");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [syncState, setSyncState] = useState<"synced" | "saving" | "offline">("saving");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showDeviceAdd, setShowDeviceAdd] = useState(false);
  const [showChatGPTImport, setShowChatGPTImport] = useState(false);
  const [devices, setDevices] = useState<DeviceSource[]>([]);
  const [executiveSummary, setExecutiveSummary] = useState<ExecutiveSummary | null>(null);
  const [lifecycleProgress, setLifecycleProgress] = useState<LifecycleProgress | null>(null);
  const [deviceBusy, setDeviceBusy] = useState(false);
  const [chatGPTBusy, setChatGPTBusy] = useState(false);
  const [chatGPTProgress, setChatGPTProgress] = useState(0);
  const [toast, setToast] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lifecycleRunning = useRef(false);

  const showToast = (message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2600);
  };

  useEffect(() => {
    let active = true;
    const refresh = async (initial = false) => {
      try {
        const summaryPromise = fetch("/api/executive-summary", { cache: "no-store" });
        const [taskResponse, deviceResponse] = await Promise.all([
          fetch("/api/tasks", { cache: "no-store" }),
          fetch("/api/devices", { cache: "no-store" }),
        ]);
        if (!taskResponse.ok || !deviceResponse.ok) throw new Error("sync unavailable");
        const taskData = (await taskResponse.json()) as { tasks: Task[] };
        const deviceData = (await deviceResponse.json()) as { devices: DeviceSource[] };
        if (!active) return;
        setTasks(taskData.tasks);
        setDevices(deviceData.devices);
        setSyncState("synced");
        void summaryPromise
          .then(async (response) => (response.ok ? ((await response.json()) as ExecutiveSummary) : null))
          .then((summary) => {
            if (active && summary) setExecutiveSummary(summary);
          })
          .catch(() => undefined);
      } catch {
        if (!active) return;
        setSyncState("offline");
        if (initial) showToast("当前使用本地预览数据，联网后会自动同步");
      } finally {
        if (initial && active) setIsLoading(false);
      }
    };
    void refresh(true);
    const interval = window.setInterval(() => void refresh(false), 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh(false);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  useEffect(() => {
    if (isLoading || syncState !== "synced") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const reviewNextBatch = async () => {
      if (cancelled || lifecycleRunning.current) return;
      lifecycleRunning.current = true;
      try {
        const response = await fetch("/api/lifecycle-review", { method: "POST" });
        if (!response.ok) return;
        const data = (await response.json()) as LifecycleProgress & { tasks: Task[] };
        if (cancelled) return;
        setTasks(data.tasks);
        setLifecycleProgress((current) => ({
          reviewed: (current?.reviewed ?? 0) + data.reviewed,
          remaining: data.remaining,
          archived: (current?.archived ?? 0) + data.archived,
          referenced: (current?.referenced ?? 0) + data.referenced,
          paused: data.paused,
        }));
        if (data.remaining > 0 && !data.paused) {
          timer = setTimeout(reviewNextBatch, 10_000);
        }
      } catch {
        // Device sync and manual controls continue to work if background sorting is temporarily unavailable.
      } finally {
        lifecycleRunning.current = false;
      }
    };
    timer = setTimeout(reviewNextBatch, 3_000);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [isLoading, syncState]);

  const projects = useMemo(
    () => ["全部项目", ...Array.from(new Set(tasks.map((task) => task.project)))],
    [tasks],
  );

  const accounts = useMemo(
    () => ["全部账号", ...Array.from(new Set(tasks.map(taskAccount)))],
    [tasks],
  );

  const deviceNames = useMemo(() => {
    const names = new Set(
      devices.filter((device) => !device.revokedAt).map((device) => device.deviceName),
    );
    tasks.flatMap(taskDevices).forEach((name) => {
      if (name !== "任意设备" && name !== "来源设备") names.add(name);
    });
    return ["全部电脑", ...Array.from(names)];
  }, [devices, tasks]);
  const effectiveDeviceScope = deviceNames.includes(deviceScope) ? deviceScope : "全部电脑";

  const filterBaseTasks = useMemo(
    () =>
      tasks.filter((task) => {
        const matchesProject = project === "全部项目" || task.project === project;
        const matchesAccount = account === "全部账号" || taskAccount(task) === account;
        const matchesSource = sourceScope === "all" || task.sourceKind === sourceScope;
        return matchesProject && matchesAccount && matchesSource;
      }),
    [tasks, project, account, sourceScope],
  );

  const scopedTasks = useMemo(
    () => filterBaseTasks.filter((task) => taskMatchesDevice(task, effectiveDeviceScope)),
    [filterBaseTasks, effectiveDeviceScope],
  );

  const visibleTasks = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return scopedTasks
      .filter((task) => {
        const matchesView =
          view === "completed" ? task.status === "done"
            : view === "library" ? task.status === "reference"
              : view === "archive" ? task.status === "archived"
                : view === "sync" ? true
                  : isAttentionTask(task);
        const haystack = `${task.title} ${task.summary} ${task.nextAction} ${task.project} ${taskAccount(task)} ${task.device} ${task.tags.join(" ")}`.toLowerCase();
        return matchesView && (!normalized || haystack.includes(normalized));
      })
      .sort((a, b) => taskScore(b) - taskScore(a) || new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime());
  }, [scopedTasks, query, view]);

  const selectedTask = selectedId ? tasks.find((task) => task.id === selectedId) ?? null : null;
  const counts = useMemo(
    () =>
      statusOrder.reduce<Record<TaskStatus, number>>(
        (result, status) => ({ ...result, [status]: scopedTasks.filter((task) => task.status === status).length }),
        { inbox: 0, mine: 0, running: 0, waiting: 0, suggested: 0, reference: 0, archived: 0, done: 0 },
      ),
    [scopedTasks],
  );

  const persist = async (id: string, patch: Partial<Task>, success?: string) => {
    const before = tasks;
    const currentTask = tasks.find((task) => task.id === id);
    const baseVersion = currentTask?.version ?? 1;
    const now = new Date().toISOString();
    setTasks((current) =>
      current.map((task) =>
        task.id === id
          ? {
              ...task,
              ...patch,
              lastActivityAt: patch.lastActivityAt ?? now,
              version: baseVersion + 1,
              updatedAt: now,
            }
          : task,
      ),
    );
    setSyncState("saving");
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          id,
          baseVersion,
          patch: { ...patch, lastActivityAt: patch.lastActivityAt ?? now },
        }),
      });
      if (response.status === 409) {
        const conflict = (await response.json()) as { tasks: Task[] };
        setTasks(conflict.tasks);
        setSyncState("synced");
        showToast("另一台设备刚刚更新了这项任务，已保留较新的版本");
        return;
      }
      if (!response.ok) throw new Error("save failed");
      const data = (await response.json()) as { tasks: Task[] };
      setTasks(data.tasks);
      setSyncState("synced");
      if (success) showToast(success);
    } catch {
      setTasks(before);
      setSyncState("offline");
      showToast("保存失败，已恢复原状态");
    }
  };

  const markDone = (task: Task) =>
    persist(task.id, { status: "done", completedAt: new Date().toISOString(), reason: "由你确认完成" }, "已完成，可随时在“已完成”中恢复");

  const snooze = (task: Task) =>
    persist(
      task.id,
      {
        status: "waiting",
        snoozedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        reason: "已暂停提醒 24 小时",
      },
      "已稍后处理，24 小时内不再提醒",
    );

  const continueTask = (task: Task) => {
    if (!task.sourceThreadId) {
      showToast("这是手动任务，没有关联原对话");
      return;
    }
    if (task.sourceKind === "chatgpt") {
      const target = getChatGPTTarget(task.sourceThreadId);
      if (!target) {
        showToast("这条记录缺少可定位的 ChatGPT 原对话地址");
        return;
      }
      window.open(target.url, "_blank", "noopener,noreferrer");
      showToast(
        target.kind === "shared"
          ? "已打开共享快照；共享页只能查看，不能替代原账号对话"
          : `已定位${taskAccount(task)}的原对话；请使用登录该账号的浏览器配置`,
      );
      return;
    }
    navigator.clipboard?.writeText(task.sourceThreadId).catch(() => undefined);
    showToast("正在打开对应的 Codex 任务；任务 ID 也已复制");
    window.location.href = `codex://threads/${encodeURIComponent(task.sourceThreadId)}`;
  };

  const addTask = async (task: Task) => {
    setTasks((current) => [task, ...current]);
    setShowAdd(false);
    setSyncState("saving");
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", task }),
      });
      if (!response.ok) throw new Error("create failed");
      const data = (await response.json()) as { tasks: Task[] };
      setTasks(data.tasks);
      setSyncState("synced");
      showToast("新任务已加入收件箱");
    } catch {
      setSyncState("offline");
      showToast("任务暂存在本页，本次预览结束后不会保留");
    }
  };

  const exportTasks = () => {
    const blob = new Blob([JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), accounts: accounts.slice(1), tasks }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `threadline-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    showToast("任务数据已导出");
  };

  const importTasks = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text()) as { tasks?: Task[] } | Task[];
      const rawImported = Array.isArray(payload) ? payload : payload.tasks;
      if (!Array.isArray(rawImported)) throw new Error("invalid format");
      const imported = normalizeSnapshotTasks(rawImported);
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "import", tasks: imported }),
      });
      if (!response.ok) throw new Error("import failed");
      const data = (await response.json()) as { tasks: Task[] };
      setTasks(data.tasks);
      setSyncState("synced");
      showToast(`已导入 ${imported.length} 项任务`);
    } catch {
      showToast("导入失败，请选择 Threadline 导出的 JSON 文件");
    } finally {
      event.target.value = "";
    }
  };

  const addDevice = async (deviceName: string, accountAlias: string) => {
    setDeviceBusy(true);
    try {
      const response = await fetch("/api/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", deviceName, accountAlias }),
      });
      if (!response.ok) throw new Error("device create failed");
      const data = (await response.json()) as {
        pairing: PairingConfig;
        devices: DeviceSource[];
      };
      setDevices(data.devices);
      const safeName = deviceName.replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(0, 32) || "device";
      downloadText(
        `Threadline-连接-${accountAlias}-${safeName}.ps1`,
        buildCloudInstaller(data.pairing),
        "text/plain;charset=utf-8",
      );
      setShowDeviceAdd(false);
      showToast("连接脚本已下载；在对应电脑运行一次即可自动同步");
    } catch {
      showToast("连接脚本生成失败，请稍后重试");
    } finally {
      setDeviceBusy(false);
    }
  };

  const revokeDevice = async (device: DeviceSource) => {
    if (!window.confirm(`停止“${device.deviceName}”继续上传？历史任务不会删除。`)) return;
    setDeviceBusy(true);
    try {
      const response = await fetch("/api/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revoke", id: device.id }),
      });
      if (!response.ok) throw new Error("revoke failed");
      const data = (await response.json()) as { devices: DeviceSource[] };
      setDevices(data.devices);
      showToast("设备连接已撤销，历史任务仍然保留");
    } catch {
      showToast("撤销失败，请稍后重试");
    } finally {
      setDeviceBusy(false);
    }
  };

  const importChatGPTHistory = async (file: File, accountAlias: string) => {
    setChatGPTBusy(true);
    setChatGPTProgress(0);
    try {
      const parsed = parseChatGPTExport(JSON.parse(await file.text()));
      if (!parsed.length) throw new Error("empty export");
      const conversations = parsed.slice(0, 5000);
      let imported = 0;
      for (let index = 0; index < conversations.length; index += 24) {
        const batch = conversations.slice(index, index + 24);
        const response = await fetch("/api/chatgpt-import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountAlias, conversations: batch }),
        });
        if (!response.ok) throw new Error("import batch failed");
        const result = (await response.json()) as { imported?: number };
        imported += result.imported ?? batch.length;
        setChatGPTProgress(Math.round(((index + batch.length) / conversations.length) * 100));
      }
      const [taskResponse, summaryResponse] = await Promise.all([
        fetch("/api/tasks", { cache: "no-store" }),
        fetch("/api/executive-summary", { cache: "no-store" }),
      ]);
      if (taskResponse.ok) setTasks(((await taskResponse.json()) as { tasks: Task[] }).tasks);
      if (summaryResponse.ok) setExecutiveSummary((await summaryResponse.json()) as ExecutiveSummary);
      setSyncState("synced");
      setShowChatGPTImport(false);
      showToast(`已纳入 ${imported} 个 ChatGPT 对话，并完成增量判断`);
    } catch {
      showToast("导入失败，请选择 ChatGPT 导出的 conversations.json");
    } finally {
      setChatGPTBusy(false);
      setChatGPTProgress(0);
    }
  };

  const addChatGPTConnector = async (accountAlias: string) => {
    setDeviceBusy(true);
    try {
      const pairingKey = `threadline.chatgpt.pairing.v2.${accountAlias}`;
      let pairing: PairingConfig | null = null;
      try {
        pairing = JSON.parse(localStorage.getItem(pairingKey) || "null") as PairingConfig | null;
      } catch {
        pairing = null;
      }
      if (!pairing?.device_token) {
        const response = await fetch("/api/devices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "create",
            deviceName: `ChatGPT 网页 · ${accountAlias}`,
            accountAlias,
            reuseExisting: true,
          }),
        });
        if (!response.ok) throw new Error("connector create failed");
        const data = (await response.json()) as { pairing: PairingConfig; devices: DeviceSource[] };
        pairing = data.pairing;
        localStorage.setItem(pairingKey, JSON.stringify(pairing));
        setDevices(data.devices);
      }
      downloadText(
        `Threadline-ChatGPT-${accountAlias}.user.js`,
        buildChatGPTConnector(pairing),
        "application/javascript;charset=utf-8",
      );
      showToast("全量回填连接器已下载；覆盖旧脚本并刷新 ChatGPT 后，点击右下角“一键回填历史”");
    } catch {
      showToast("网页连接器生成失败，请稍后重试");
    } finally {
      setDeviceBusy(false);
    }
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="brand-row">
          <div className="brand-mark" aria-hidden="true"><Command size={20} /></div>
          <div><strong>Threadline</strong><span>AI 工作驾驶舱</span></div>
          <button className="icon-button mobile-close" onClick={() => setSidebarOpen(false)} aria-label="关闭导航"><X size={19} /></button>
        </div>

        <nav className="main-nav" aria-label="主导航">
          {navItems.map((item) => {
            const Icon = item.icon;
            const badge = item.id === "today" ? counts.mine
              : item.id === "library" ? counts.reference
                : item.id === "completed" ? counts.done
                  : item.id === "archive" ? counts.archived
                    : 0;
            return (
              <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => { setView(item.id); setSidebarOpen(false); }}>
                <Icon size={18} />
                <span>{item.label}</span>
                {badge > 0 && <span className="nav-badge">{badge}</span>}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-section">
          <p>来源</p>
          {(["codex", "chatgpt", "manual"] as const).map((source) => (
            <button key={source} className={`project-link source-link ${sourceScope === source ? "active" : ""}`} onClick={() => { setSourceScope(sourceScope === source ? "all" : source); setSidebarOpen(false); }}>
              <span className={`source-dot source-${source}`} />
              <span>{sourceLabels[source]}</span>
              <small>{tasks.filter((task) => task.sourceKind === source && isAttentionTask(task)).length}</small>
            </button>
          ))}
        </div>

        <div className="sidebar-section">
          <p>账号</p>
          {accounts.slice(1).map((name) => (
            <button key={name} className={`project-link account-link ${account === name ? "active" : ""}`} onClick={() => { setAccount(account === name ? "全部账号" : name); setSidebarOpen(false); }}>
              <span className="account-avatar">{name.replace("账号", "") || "·"}</span>
              <span>{name}</span>
              <small>{tasks.filter((task) => taskAccount(task) === name && isAttentionTask(task)).length}</small>
            </button>
          ))}
        </div>

        <div className="sidebar-section projects-section">
          <p>项目</p>
          {projects.slice(1).map((name) => (
            <button key={name} className={`project-link ${project === name ? "active" : ""}`} onClick={() => { setProject(project === name ? "全部项目" : name); setSidebarOpen(false); }}>
              <span className="project-dot" />
              <span>{name}</span>
              <small>{tasks.filter((task) => task.project === name && isAttentionTask(task)).length}</small>
            </button>
          ))}
        </div>

        <div className="sync-card">
          <div className="sync-card-title"><Wifi size={16} /><strong>{devices.some((device) => !device.revokedAt) ? "自动同步已启用" : "等待连接设备"}</strong></div>
          <p>{devices.filter((device) => !device.revokedAt).length} 个连接器 · 多来源统一</p>
          <div className="sync-line"><span /><span /></div>
          <button onClick={() => setView("sync")}>管理同步 <ArrowRight size={14} /></button>
        </div>
      </aside>

      {sidebarOpen && <button className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} aria-label="关闭导航" />}

      <main className="main-area" id="main-content">
        <header className="topbar">
          <button className="icon-button menu-button" onClick={() => setSidebarOpen(true)} aria-label="打开导航"><Menu size={20} /></button>
          <div className="search-wrap">
            <Search size={17} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索任务、项目或下一步" aria-label="搜索任务" />
            <kbd>⌘ K</kbd>
          </div>
          <div className="topbar-actions">
            <label className="select-control device-select"><Monitor size={16} /><select value={effectiveDeviceScope} onChange={(event) => setDeviceScope(event.target.value)} aria-label="筛选设备或连接器">{deviceNames.map((name) => <option key={name}>{name}</option>)}</select><ChevronDown size={14} /></label>
            <label className="select-control source-select"><MessageSquareText size={16} /><select value={sourceScope} onChange={(event) => setSourceScope(event.target.value as SourceScope)} aria-label="筛选来源">{(["all", "codex", "chatgpt", "manual"] as const).map((source) => <option key={source} value={source}>{sourceLabels[source]}</option>)}</select><ChevronDown size={14} /></label>
            <label className="select-control account-select"><UserRound size={16} /><select value={account} onChange={(event) => setAccount(event.target.value)} aria-label="筛选账号">{accounts.map((name) => <option key={name}>{name}</option>)}</select><ChevronDown size={14} /></label>
            <label className="select-control"><Filter size={16} /><select value={project} onChange={(event) => setProject(event.target.value)} aria-label="筛选项目">{projects.map((name) => <option key={name}>{name}</option>)}</select><ChevronDown size={14} /></label>
            <div className={`sync-status ${syncState}`} title="同步状态">
              {syncState === "saving" ? <LoaderCircle size={15} className="spin" /> : syncState === "synced" ? <Cloud size={15} /> : <RefreshCw size={15} />}
              <span>{syncState === "saving" ? "保存中" : syncState === "synced" ? "已同步" : "离线"}</span>
            </div>
            <button className="primary-button compact" onClick={() => setShowAdd(true)}><Plus size={17} /><span>添加任务</span></button>
          </div>
        </header>

        <div className="content-wrap">
          {view !== "sync" && (
            <DeviceScopeBar
              tasks={filterBaseTasks}
              devices={devices}
              selected={effectiveDeviceScope}
              onSelect={setDeviceScope}
            />
          )}
          {view === "today" && (
            <TodayView
              tasks={visibleTasks}
              allTasks={scopedTasks}
              deviceScope={effectiveDeviceScope}
              devices={devices}
              executiveSummary={executiveSummary}
              lifecycleProgress={lifecycleProgress}
              onOpen={setSelectedId}
              onDone={markDone}
              onSnooze={snooze}
              onContinue={continueTask}
              onUpgrade={() => downloadText("Threadline-升级智能判断.ps1", buildAnalyzerUpgrade())}
            />
          )}
          {view === "board" && (
            <BoardView tasks={visibleTasks} dragId={dragId} setDragId={setDragId} onDrop={(status) => { const task = tasks.find((item) => item.id === dragId); if (task) persist(task.id, { status, completedAt: status === "done" ? new Date().toISOString() : null, reason: `手动移至${statusMeta[status].label}` }); setDragId(null); }} onOpen={setSelectedId} onDone={markDone} onSnooze={snooze} onContinue={continueTask} />
          )}
          {view === "console" && (
            <ConsoleView tasks={visibleTasks.filter(isAttentionTask)} onOpen={setSelectedId} onContinue={continueTask} />
          )}
          {view === "library" && (
            <PassiveView kind="reference" tasks={visibleTasks} onOpen={setSelectedId} onRestore={(task) => persist(task.id, { status: "suggested", completedAt: null, reason: "从资料库重新激活", manualOverride: true }, "已恢复到建议继续")} />
          )}
          {view === "completed" && (
            <CompletedView tasks={visibleTasks} onOpen={setSelectedId} onRestore={(task) => persist(task.id, { status: "suggested", completedAt: null, reason: "重新打开" }, "任务已恢复到建议继续")} />
          )}
          {view === "archive" && (
            <PassiveView kind="archived" tasks={visibleTasks} onOpen={setSelectedId} onRestore={(task) => persist(task.id, { status: "suggested", completedAt: null, reason: "从归档恢复", manualOverride: true }, "已恢复到建议继续")} />
          )}
          {view === "sync" && (
            <SyncView
              tasks={tasks}
              accounts={accounts.slice(1)}
              devices={devices}
              deviceBusy={deviceBusy}
              syncState={syncState}
              onAddDevice={() => setShowDeviceAdd(true)}
              onRevokeDevice={revokeDevice}
              onExport={exportTasks}
              onImport={importTasks}
              onImportChatGPT={() => setShowChatGPTImport(true)}
              onAddChatGPTConnector={addChatGPTConnector}
              chatGPTBusy={chatGPTBusy || deviceBusy}
            />
          )}
        </div>
      </main>

      {selectedTask && (
        <TaskDrawer task={selectedTask} onClose={() => setSelectedId(null)} onDone={markDone} onSnooze={snooze} onContinue={continueTask} onUpdate={(patch, message) => persist(selectedTask.id, patch, message)} />
      )}
      {showAdd && <AddTaskModal projects={projects.slice(1)} accounts={accounts.slice(1)} defaultAccount={account === "全部账号" ? accounts[1] ?? "账号1" : account} onClose={() => setShowAdd(false)} onSubmit={addTask} />}
      {showDeviceAdd && (
        <AddDeviceModal
          busy={deviceBusy}
          onClose={() => setShowDeviceAdd(false)}
          onSubmit={addDevice}
        />
      )}
      {showChatGPTImport && (
        <ChatGPTImportModal
          busy={chatGPTBusy}
          progress={chatGPTProgress}
          defaultAccount={account === "全部账号" ? "账号1" : account}
          onClose={() => !chatGPTBusy && setShowChatGPTImport(false)}
          onSubmit={importChatGPTHistory}
        />
      )}
      {toast && <div className="toast" role="status"><Check size={16} />{toast}</div>}
      {isLoading && <div className="loading-bar" />}
    </div>
  );
}

function DeviceScopeBar({ tasks, devices, selected, onSelect }: {
  tasks: Task[];
  devices: DeviceSource[];
  selected: string;
  onSelect: (device: string) => void;
}) {
  const activeDevices = devices.filter((device) => !device.revokedAt);
  const choices = [
    { name: "全部电脑", device: null as DeviceSource | null },
    ...activeDevices.map((device) => ({ name: device.deviceName, device })),
  ];
  return (
    <section className="device-scope" aria-label="按设备或来源连接器查看任务">
      {choices.map(({ name, device }) => {
        const scoped = tasks.filter((task) => taskMatchesDevice(task, name));
        const open = scoped.filter((task) => task.status !== "done");
        const decisions = open.filter((task) =>
          task.status === "mine" || task.status === "suggested" || task.status === "inbox",
        );
        const running = open.filter((task) => task.status === "running");
        const webDevice = device ? isChatGPTWebDevice(device) : false;
        const ready = !device || (webDevice ? Boolean(device.lastSyncAt) : supportsSemanticSync(device.agentVersion));
        const DeviceIcon = webDevice ? MessageSquareText : Monitor;
        return (
          <button
            key={name}
            className={selected === name ? "active" : ""}
            onClick={() => onSelect(name)}
            aria-pressed={selected === name}
          >
            <span className="device-scope-title"><DeviceIcon size={15} />{name}{device && <i className={ready ? "ready" : "upgrade"} />}</span>
            <span className="device-scope-count"><strong>{scoped.length}</strong> 项已收录</span>
            <small>{decisions.length} 待拍板 · {running.length} 执行中</small>
          </button>
        );
      })}
    </section>
  );
}

function TodayView({ tasks, allTasks, deviceScope, devices, executiveSummary, lifecycleProgress, onOpen, onDone, onSnooze, onContinue, onUpgrade }: {
  tasks: Task[];
  allTasks: Task[];
  deviceScope: string;
  devices: DeviceSource[];
  executiveSummary: ExecutiveSummary | null;
  lifecycleProgress: LifecycleProgress | null;
  onOpen: (id: string) => void;
  onDone: (task: Task) => void;
  onSnooze: (task: Task) => void;
  onContinue: (task: Task) => void;
  onUpgrade: () => void;
}) {
  const openTasks = tasks.filter(isAttentionTask);
  const workingSet = openTasks.slice(0, 40);
  const backlogCount = Math.max(0, openTasks.length - workingSet.length);
  const libraryCount = allTasks.filter((task) => task.status === "reference").length;
  const archiveCount = allTasks.filter((task) => task.status === "archived").length;
  const decisions = workingSet.filter((task) =>
    task.status === "mine" || task.status === "suggested" || task.status === "inbox",
  );
  const mine = workingSet.filter((task) => task.status === "mine");
  const running = workingSet.filter((task) => task.status === "running");
  const suggestions = selectPriorityTasks(decisions.length ? decisions : running, 3);
  const outdatedDevices = devices.filter(
    (device) => !device.revokedAt && !isChatGPTWebDevice(device) && !supportsSemanticSync(device.agentVersion),
  );
  return (
    <>
      <section className="page-heading">
        <div>
          <span className="eyebrow">领导驾驶舱 · {deviceScope}</span>
          <h1>只看需要你拍板的事。</h1>
          <p>已收录 {allTasks.length} 项，只保留 {workingSet.length} 个工作窗口；{libraryCount} 项沉淀为资料，{archiveCount} 项已从视野中收起。</p>
        </div>
        <div className="focus-score"><div><Sparkles size={18} /><strong>{suggestions.length}</strong></div><span>优先拍板</span></div>
      </section>

      <section className="executive-memo">
        <span className="memo-icon"><BrainCircuit size={20} /></span>
        <div>
          <span>AI · 全局领导摘要</span>
          <p>{executiveSummary?.summary ?? "正在把全部对话压缩成一段可决策的总览……"}</p>
          {executiveSummary?.actions?.length ? <div className="memo-actions">{executiveSummary.actions.map((action, index) => <small key={`${action}-${index}`}>{index + 1}. {action}</small>)}</div> : null}
        </div>
      </section>

      <section className="briefing-strip" aria-label="自动汇报状态">
        <div><span className="briefing-icon"><BrainCircuit size={18} /></span><p><strong>{lifecycleProgress?.remaining ? `正在整理剩余 ${lifecycleProgress.remaining} 项` : "持续巡检中"}</strong><small>{lifecycleProgress?.reviewed ? `本次已整理 ${lifecycleProgress.reviewed} 项；旧而有用的内容会进入资料库` : "变化任务实时判断，历史记录分批整理"}</small></p></div>
        <div><span>等你拍板</span><strong>{mine.length}</strong></div>
        <div><span>AI 处理中</span><strong>{running.length}</strong></div>
        <div><span>资料沉淀</span><strong>{libraryCount}</strong></div>
        <div><span>后台积压</span><strong>{backlogCount}</strong></div>
      </section>

      {outdatedDevices.length > 0 && (
        <section className="upgrade-notice">
          <div><BrainCircuit size={18} /><p><strong>{outdatedDevices.length} 台电脑尚未开启智能汇报</strong><span>升级一次采集器后，新增对话才会持续交给你配置的模型判断。</span></p></div>
          <button className="secondary-button" onClick={onUpgrade}><Download size={16} />下载统一升级脚本</button>
        </section>
      )}

      <section className="suggestion-grid">
        {suggestions.map((task, index) => (
          <article className="hero-task" key={task.id} onClick={() => onOpen(task.id)}>
            <div className="hero-task-top"><span className="rank">0{index + 1}</span><PriorityBadge priority={task.priority} /></div>
            <div className="status-line"><Sparkles size={14} />{task.reason}</div>
            <h2>{task.title}</h2>
            <p className="next-action"><span>下一步</span>{task.nextAction}</p>
            <div className="card-meta"><AccountBadge account={taskAccount(task)} /><SourceBadge source={task.sourceKind} /><span>{task.project}</span><span>{task.device}</span><span>{getRelativeTime(task.lastActivityAt)}</span></div>
            <div className="card-actions" onClick={(event) => event.stopPropagation()}>
              <button className="primary-button" onClick={() => onContinue(task)}>{continueButtonLabel(task)} <ArrowRight size={16} /></button>
              <button className="secondary-button" onClick={() => onDone(task)}><Check size={16} />完成</button>
              <button className="icon-button" onClick={() => onSnooze(task)} aria-label="稍后提醒"><TimerReset size={17} /></button>
            </div>
          </article>
        ))}
      </section>

      <section className="overview-grid">
        <div className="panel">
          <PanelHeader icon={UserRound} title="等你拍板" count={mine.length} subtitle="只保留需要回复、选择或确认的事项" />
          <div className="compact-list">{mine.length ? mine.map((task) => <CompactTask key={task.id} task={task} onOpen={onOpen} />) : <EmptyLine text="暂时没有需要你处理的任务" />}</div>
        </div>
        <div className="panel">
          <PanelHeader icon={Activity} title="AI 处理中" count={running.length} subtitle="你暂时不需要介入的进行中工作" />
          <div className="compact-list">{running.map((task) => <CompactTask key={task.id} task={task} onOpen={onOpen} running />)}</div>
        </div>
        <div className="panel wide-panel">
          <PanelHeader icon={TimerReset} title="建议介入" count={stale.length} subtitle="已经停滞，或存在明确可执行的下一步" />
          <div className="stale-grid">{stale.map((task) => <CompactTask key={task.id} task={task} onOpen={onOpen} />)}</div>
        </div>
      </section>
    </>
  );
}

function BoardView({ tasks, dragId, setDragId, onDrop, onOpen, onDone, onSnooze, onContinue }: {
  tasks: Task[];
  dragId: string | null;
  setDragId: (id: string | null) => void;
  onDrop: (status: TaskStatus) => void;
  onOpen: (id: string) => void;
  onDone: (task: Task) => void;
  onSnooze: (task: Task) => void;
  onContinue: (task: Task) => void;
}) {
  const columns: TaskStatus[] = ["mine", "running", "suggested", "waiting"];
  return (
    <>
      <section className="simple-heading"><div><span className="eyebrow">活跃工作区</span><h1>状态看板</h1><p>这里只显示仍需推进的工作；资料、完成项和低价值历史已分开收纳。</p></div><div className="view-hint"><Columns3 size={17} />{tasks.filter(isAttentionTask).length} 个工作窗口</div></section>
      <div className="kanban">
        {columns.map((status) => {
          const Icon = statusIcons[status];
          const columnTasks = tasks.filter((task) => task.status === status);
          return (
            <section className={`kanban-column status-${status} ${dragId ? "is-dragging" : ""}`} key={status} onDragOver={(event) => event.preventDefault()} onDrop={() => onDrop(status)}>
              <header><div><Icon size={17} className={status === "running" ? "spin-slow" : ""} /><strong>{statusMeta[status].label}</strong><span>{columnTasks.length}</span></div><button className="icon-button" aria-label={`${statusMeta[status].label}选项`}><MoreHorizontal size={17} /></button></header>
              <p className="column-description">{statusMeta[status].description}</p>
              <div className="column-tasks">
                {columnTasks.map((task) => (
                  <TaskCard key={task.id} task={task} onOpen={onOpen} onDone={onDone} onSnooze={onSnooze} onContinue={onContinue} onDragStart={() => setDragId(task.id)} onDragEnd={() => setDragId(null)} />
                ))}
                {!columnTasks.length && <div className="drop-empty">把任务拖到这里</div>}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}

function ConsoleView({ tasks, onOpen, onContinue }: { tasks: Task[]; onOpen: (id: string) => void; onContinue: (task: Task) => void }) {
  return (
    <>
      <section className="simple-heading"><div><span className="eyebrow">高密度模式</span><h1>任务控制台</h1><p>集中查看活跃工作，不再混入资料库和低价值历史。</p></div><div className="view-hint"><LayoutList size={17} />按推荐分排序</div></section>
      <div className="table-panel">
        <table>
          <thead><tr><th>状态</th><th>账号</th><th>来源</th><th>任务</th><th>下一步</th><th>推荐</th><th>项目</th><th>设备</th><th>最近推进</th><th><span className="sr-only">操作</span></th></tr></thead>
          <tbody>
            {tasks.map((task) => {
              const Icon = statusIcons[task.status];
              return (
                <tr key={task.id} onClick={() => onOpen(task.id)}>
                  <td><span className={`table-status status-${task.status}`}><Icon size={14} />{statusMeta[task.status].label}</span></td>
                  <td><AccountBadge account={taskAccount(task)} /></td>
                  <td><SourceBadge source={task.sourceKind} /></td>
                  <td><strong>{task.title}</strong><small>{task.reason}</small></td>
                  <td className="next-cell">{task.nextAction}</td>
                  <td><span className={`score-pill score-${Math.floor(taskScore(task) / 20)}`}>{taskScore(task)}</span></td>
                  <td>{task.project}</td><td><span className="device-cell"><Monitor size={14} />{task.device}</span></td><td>{getRelativeTime(task.lastActivityAt)}</td>
                  <td><button className="icon-button" onClick={(event) => { event.stopPropagation(); onContinue(task); }} aria-label={`${continueButtonLabel(task)}：${task.title}`} title={continueButtonLabel(task)}><ArrowRight size={16} /></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function CompletedView({ tasks, onOpen, onRestore }: { tasks: Task[]; onOpen: (id: string) => void; onRestore: (task: Task) => void }) {
  return (
    <>
      <section className="simple-heading"><div><span className="eyebrow">已经收尾</span><h1>已完成</h1><p>完成不会删除原对话，需要时可以恢复。</p></div><div className="view-hint"><CheckCircle2 size={17} />{tasks.length} 项</div></section>
      <div className="completed-list">
        {tasks.length ? tasks.map((task) => (
          <article key={task.id} onClick={() => onOpen(task.id)}><div className="completed-check"><Check size={18} /></div><div><h3>{task.title}</h3><p><AccountBadge account={taskAccount(task)} /><SourceBadge source={task.sourceKind} />{task.summary}</p></div><span>{task.completedAt ? getRelativeTime(task.completedAt) : "已完成"}</span><button className="secondary-button" onClick={(event) => { event.stopPropagation(); onRestore(task); }}><RotateCcw size={15} />恢复</button></article>
        )) : <div className="large-empty"><CheckCircle2 size={30} /><h2>还没有已完成任务</h2><p>完成的任务会安全地保存在这里。</p></div>}
      </div>
    </>
  );
}

function PassiveView({ kind, tasks, onOpen, onRestore }: { kind: "reference" | "archived"; tasks: Task[]; onOpen: (id: string) => void; onRestore: (task: Task) => void }) {
  const reference = kind === "reference";
  const Icon = reference ? BookOpen : Archive;
  return (
    <>
      <section className="simple-heading">
        <div>
          <span className="eyebrow">{reference ? "旧而有用" : "可逆收纳"}</span>
          <h1>{reference ? "资料库" : "低价值归档"}</h1>
          <p>{reference ? "保留已经没有待办、但仍值得搜索和复用的结论、代码与项目背景。" : "测试、重复、被替代和没有目标的记录会从工作区收起，但不会删除原对话。"}</p>
        </div>
        <div className="view-hint"><Icon size={17} />{tasks.length} 项</div>
      </section>
      <div className={`completed-list passive-list ${reference ? "reference-list" : "archive-list"}`}>
        {tasks.length ? tasks.map((task) => (
          <article key={task.id} onClick={() => onOpen(task.id)}>
            <div className="completed-check"><Icon size={18} /></div>
            <div><h3>{task.title}</h3><p><AccountBadge account={taskAccount(task)} /><SourceBadge source={task.sourceKind} />{task.summary}</p></div>
            <span>{getRelativeTime(task.lastActivityAt)}</span>
            <button className="secondary-button" onClick={(event) => { event.stopPropagation(); onRestore(task); }}><RotateCcw size={15} />重新激活</button>
          </article>
        )) : <div className="large-empty"><Icon size={30} /><h2>{reference ? "资料库还在整理" : "还没有低价值归档"}</h2><p>{reference ? "旧而有用的对话会自动沉淀在这里。" : "系统只会在置信度很高时自动收起低价值记录。"}</p></div>}
      </div>
    </>
  );
}

function SyncView({
  tasks,
  accounts,
  devices,
  deviceBusy,
  syncState,
  onAddDevice,
  onRevokeDevice,
  onExport,
  onImport,
  onImportChatGPT,
  onAddChatGPTConnector,
  chatGPTBusy,
}: {
  tasks: Task[];
  accounts: string[];
  devices: DeviceSource[];
  deviceBusy: boolean;
  syncState: string;
  onAddDevice: () => void;
  onRevokeDevice: (device: DeviceSource) => void;
  onExport: () => void;
  onImport: (event: ChangeEvent<HTMLInputElement>) => void;
  onImportChatGPT: () => void;
  onAddChatGPTConnector: (accountAlias: string) => void;
  chatGPTBusy: boolean;
}) {
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const activeDevices = devices.filter((device) => !device.revokedAt);
  const codexDevices = activeDevices.filter((device) => !isChatGPTWebDevice(device));
  const webConnectors = activeDevices.filter(isChatGPTWebDevice);
  const onlineDevices = activeDevices.filter(
    (device) =>
      Boolean(device.lastSeenAt) &&
      clock - new Date(device.lastSeenAt!).getTime() < 30 * 60 * 1000,
  );

  return (
    <>
      <section className="simple-heading">
        <div>
          <span className="eyebrow">跨设备连续工作</span>
          <h1>来源与自动同步</h1>
          <p>Codex 本地任务、两个 ChatGPT 云账号和手工事项进入同一个任务池，由系统统一判断和汇报。</p>
        </div>
        <div className={`view-hint sync-${syncState}`}>
          <Cloud size={17} />
          {syncState === "synced" ? "云端已同步" : syncState === "saving" ? "正在保存" : "当前离线"}
        </div>
      </section>
      <div className="settings-grid">
        <section className="settings-card featured chatgpt-source-card">
          <div className="settings-icon chatgpt"><MessageSquareText size={21} /></div>
          <div className="settings-copy">
            <span className="settings-label">ChatGPT 云对话</span>
            <h2>把两个网页账号一起纳入驾驶舱</h2>
            <p>给每个账号安装一次网页连接器，即可在 ChatGPT 页面一键回填历史；以后访问或更新过的对话会继续自动增量同步。官方历史文件到达后仍可用于补漏。</p>
            <div className="source-stat-row">
              {accounts.map((name) => {
                const count = tasks.filter((task) => task.sourceKind === "chatgpt" && taskAccount(task) === name).length;
                return <span key={name}><AccountBadge account={name} /><strong>{count}</strong> 个云对话</span>;
              })}
            </div>
            <div className="button-row chatgpt-actions">
              <button className="primary-button" onClick={onImportChatGPT} disabled={chatGPTBusy}><FileJson size={16} />导入 ChatGPT 历史</button>
              {(["账号1", "账号2"] as const).map((name) => (
                <button key={name} className="secondary-button" onClick={() => onAddChatGPTConnector(name)} disabled={chatGPTBusy}><Download size={16} />{name}网页连接器</button>
              ))}
            </div>
            <ol className="connector-guide"><li>浏览器先安装 Tampermonkey，并启用“允许用户脚本”</li><li>在 Tampermonkey 中安装或覆盖对应账号的连接器</li><li>刷新 ChatGPT，点击右下角“一键回填历史”；可暂停、续传和重试失败项</li></ol>
            <small className="privacy-note">每个历史对话都会建档；智能判断只使用开头与最近片段，代码块、密钥和本地路径会先删除。删除或临时对话无法恢复。</small>
          </div>
        </section>
        <section className="settings-card featured">
          <div className="settings-icon"><Cloud size={21} /></div>
          <div className="settings-copy">
            <span className="settings-label">终极同步模式</span>
            <h2>本机自动扫描，直接进入云端</h2>
            <p>连接脚本每 15 分钟只读扫描本机 .codex，自动去重并更新任务。启用智能判断后，只上传最近少量、已删除代码块、密钥和本地路径的对话摘录；工具输出和完整聊天不会上传。</p>
            <div className="feature-row"><span><Check size={14} />无需 OneDrive</span><span><Check size={14} />无需手动导入</span><span><Check size={14} />手动状态优先</span></div>
          </div>
        </section>
        <section className="settings-card">
          <div className="settings-icon violet"><BrainCircuit size={21} /></div>
          <div className="settings-copy">
            <span className="settings-label">智能状态判断</span>
            <h2>持续增量判断，集中向你汇报</h2>
            <p>每台电脑同步后，V4.1 Flash 会优先处理最近变化，再轮换深扫历史对话；相同内容复用缓存。模型只整理状态、理由和下一步，疑似完成仍需你确认。</p>
            <div className="feature-row"><span><Check size={14} />密钥只在云端</span><span><Check size={14} />每轮最多 24 项</span><span><Check size={14} />失败自动退回规则</span></div>
            <div className="button-row"><button className="secondary-button" onClick={() => downloadText("Threadline-升级智能判断.ps1", buildAnalyzerUpgrade())}><Download size={16} />下载采集器升级脚本</button></div>
          </div>
        </section>
        <section className="settings-card devices-card">
          <div className="devices-heading">
            <div><span className="settings-label">同步来源</span><h2>{activeDevices.length ? `${codexDevices.length} 台电脑 · ${webConnectors.length} 个网页连接器` : "连接第一个来源"}</h2><p>电脑采集器和网页连接器分别显示状态；网页连接器只有真正运行并上传后，才会计入在线。</p></div>
            <button className="primary-button" onClick={onAddDevice} disabled={deviceBusy}><Plus size={16} />添加设备</button>
          </div>
          <div className="device-list">
            {activeDevices.length ? activeDevices.map((device) => {
              const online = Boolean(device.lastSeenAt) && clock - new Date(device.lastSeenAt!).getTime() < 30 * 60 * 1000;
              const webDevice = isChatGPTWebDevice(device);
              const status = webDevice
                ? device.lastSyncAt ? "网页同步已开启" : "已生成，等待浏览器首次上传"
                : supportsSemanticSync(device.agentVersion) ? "智能汇报已开启" : "待升级智能汇报";
              const DeviceIcon = webDevice ? MessageSquareText : Monitor;
              return (
                <article className="device-row" key={device.id}>
                  <div className={`device-avatar ${online ? "online" : ""}`}><DeviceIcon size={18} /></div>
                  <div><strong>{device.deviceName}</strong><span><AccountBadge account={device.accountAlias} />{online ? "最近已同步" : device.lastSyncAt ? `上次同步 ${getRelativeTime(device.lastSyncAt)}` : "等待首次连接"} · {status}</span></div>
                  <div className="device-count"><strong>{device.recordCount}</strong><span>项对话</span></div>
                  <button className="secondary-button danger-button" onClick={() => onRevokeDevice(device)} disabled={deviceBusy}>撤销</button>
                </article>
              );
            }) : <div className="device-empty"><Monitor size={24} /><div><strong>还没有电脑连接</strong><span>添加设备后，系统会下载一个专属连接脚本。</span></div></div>}
          </div>
          <div className="device-summary"><span className="online-dot" />{onlineDevices.filter((device) => !isChatGPTWebDevice(device)).length} 台电脑最近在线 · {onlineDevices.filter(isChatGPTWebDevice).length} 个网页连接器在线 · {activeDevices.reduce((sum, device) => sum + device.recordCount, 0)} 条记录</div>
        </section>
        <section className="settings-card account-overview"><div className="settings-icon violet"><UserRound size={21} /></div><div className="settings-copy"><span className="settings-label">账号来源</span><h2>两个 Pro 账号，统一排序</h2><p>每项任务同时保留账号、来源和设备。顶部可以任意组合筛选，继续任务时会打开正确的 Codex 或 ChatGPT 原对话。</p><div className="account-stats">{accounts.map((name) => { const accountTasks = tasks.filter((task) => taskAccount(task) === name); const sources = new Set(accountTasks.map((task) => task.sourceKind)).size; return <div key={name}><AccountBadge account={name} /><strong>{accountTasks.filter(isAttentionTask).length}</strong><span>个工作窗口 · {sources} 类来源</span></div>; })}</div></div></section>
        <section className="settings-card"><div className="settings-icon amber"><Bell size={21} /></div><div className="settings-copy"><span className="settings-label">提醒节奏</span><h2>每日合并摘要</h2><p>上午 10:00 汇总待你处理、建议继续和等待解除的事项；22:00 到次日 08:00 保持安静。</p><div className="toggle-row"><div><strong>工作日收尾提醒</strong><span>17:30，只在有必要时出现</span></div><button className="toggle on" aria-label="关闭工作日收尾提醒"><span /></button></div></div></section>
        <section className="settings-card"><div className="settings-icon neutral"><Archive size={21} /></div><div className="settings-copy"><span className="settings-label">离线保险</span><h2>保留 JSON 备份</h2><p>直接云同步是主流程；JSON 只用于迁移或故障恢复，不再需要日常操作。</p><div className="button-row"><button className="secondary-button" onClick={onExport}><Download size={16} />导出备份</button><label className="secondary-button file-label"><Upload size={16} />恢复备份<input type="file" accept="application/json" onChange={onImport} /></label></div></div></section>
      </div>
      <section className="workflow-panel"><div><Zap size={19} /><strong>统一信息驾驶舱链路</strong></div><ol><li><span>1</span><div><strong>所有来源持续汇入</strong><p>三台电脑扫描 Codex，两个网页账号增量同步 ChatGPT，手工事项随时收集。</p></div></li><li><span>2</span><div><strong>云端分层整理</strong><p>仍有目标的进入工作区，旧而有用的进入资料库，明确低价值的可逆归档。</p></div></li><li><span>3</span><div><strong>只汇报需要决策的事</strong><p>首页最多保留 40 个工作窗口，优先呈现 3 个最值得你拍板的事项。</p></div></li></ol></section>
    </>
  );
}

function TaskCard({ task, onOpen, onDone, onSnooze, onContinue, onDragStart, onDragEnd }: { task: Task; onOpen: (id: string) => void; onDone: (task: Task) => void; onSnooze: (task: Task) => void; onContinue: (task: Task) => void; onDragStart: () => void; onDragEnd: () => void }) {
  return (
    <article className="task-card" draggable onDragStart={onDragStart} onDragEnd={onDragEnd} onClick={() => onOpen(task.id)}>
      <div className="task-card-top"><PriorityBadge priority={task.priority} />{task.unread && <span className="unread-pill">有新结果</span>}<button className="icon-button" aria-label="更多操作"><MoreHorizontal size={16} /></button></div>
      <h3>{task.title}</h3><p className="task-reason">{task.reason}</p>
      <div className="mini-next"><span>下一步</span><p>{task.nextAction}</p></div>
      <div className="task-card-bottom"><div><AccountBadge account={taskAccount(task)} /><SourceBadge source={task.sourceKind} /><span>{task.project}</span><span>{getRelativeTime(task.lastActivityAt)}</span></div><div className="quick-actions" onClick={(event) => event.stopPropagation()}><button onClick={() => onContinue(task)} aria-label={continueButtonLabel(task)} title={continueButtonLabel(task)}><ArrowRight size={15} /></button><button onClick={() => onSnooze(task)} aria-label="稍后提醒"><TimerReset size={15} /></button><button onClick={() => onDone(task)} aria-label="标记完成"><Check size={15} /></button></div></div>
    </article>
  );
}

function CompactTask({ task, onOpen, running = false }: { task: Task; onOpen: (id: string) => void; running?: boolean }) {
  return <button className="compact-task" onClick={() => onOpen(task.id)}><span className={`compact-icon status-${task.status}`}>{running ? <LoaderCircle size={16} className="spin-slow" /> : task.unread ? <CircleDot size={16} /> : <ArrowRight size={16} />}</span><span className="compact-copy"><strong>{task.title}</strong><small>{task.nextAction}</small></span><span className="compact-meta"><AccountBadge account={taskAccount(task)} /><SourceBadge source={task.sourceKind} /><small>{task.project}</small><span>{getRelativeTime(task.lastActivityAt)}</span></span></button>;
}

function PanelHeader({ icon: Icon, title, subtitle, count }: { icon: typeof Inbox; title: string; subtitle: string; count: number }) {
  return <header className="panel-header"><div className="panel-icon"><Icon size={18} /></div><div><h2>{title}<span>{count}</span></h2><p>{subtitle}</p></div><button className="icon-button" aria-label={`${title}选项`}><MoreHorizontal size={17} /></button></header>;
}

function PriorityBadge({ priority }: { priority: TaskPriority }) {
  return <span className={`priority priority-${priority}`}>{priority === "high" ? "高优先级" : priority === "low" ? "低优先级" : "中优先级"}</span>;
}

function AccountBadge({ account }: { account: string }) {
  return <span className={`account-badge ${account === "账号2" ? "account-two" : ""}`}><UserRound size={12} />{account}</span>;
}

function SourceBadge({ source }: { source: Task["sourceKind"] }) {
  const Icon = source === "chatgpt" ? MessageSquareText : source === "codex" ? Command : Inbox;
  return <span className={`source-badge source-${source}`}><Icon size={12} />{sourceLabels[source]}</span>;
}

function EmptyLine({ text }: { text: string }) { return <div className="empty-line"><Check size={17} />{text}</div>; }

function TaskDrawer({ task, onClose, onDone, onSnooze, onContinue, onUpdate }: { task: Task; onClose: () => void; onDone: (task: Task) => void; onSnooze: (task: Task) => void; onContinue: (task: Task) => void; onUpdate: (patch: Partial<Task>, message?: string) => void }) {
  const Icon = statusIcons[task.status];
  const passive = task.status === "reference" || task.status === "archived" || task.status === "done";
  const protectedItem = task.tags.includes("永不归档");
  const regularStatuses = statusOrder.filter((status) => status !== task.status && status !== "reference" && status !== "archived");
  const restore = () => onUpdate({ status: "suggested", completedAt: null, reason: "由你重新激活", manualOverride: true }, "已恢复到建议继续");
  const moveTo = (status: "reference" | "archived") => onUpdate({
    status,
    priority: "low",
    unread: false,
    completedAt: null,
    reason: status === "reference" ? "由你保留为资料" : "由你移入低价值归档",
    nextAction: status === "reference" ? "需要时从资料库重新激活" : "需要时从归档恢复",
    manualOverride: true,
  }, status === "reference" ? "已收入资料库" : "已归档，原对话没有删除");
  const toggleProtection = () => onUpdate({
    tags: protectedItem ? task.tags.filter((tag) => tag !== "永不归档") : [...task.tags, "永不归档"],
    manualOverride: !protectedItem,
  }, protectedItem ? "已恢复自动整理" : "已设为永不自动归档");

  return <>
    <button className="drawer-backdrop" onClick={onClose} aria-label="关闭任务详情" />
    <aside className="task-drawer" aria-label="任务详情">
      <header><div className={`drawer-status status-${task.status}`}><Icon size={16} />{statusMeta[task.status].label}</div><button className="icon-button" onClick={onClose} aria-label="关闭任务详情"><X size={20} /></button></header>
      <div className="drawer-body">
        <div className="drawer-badges"><PriorityBadge priority={task.priority} /><AccountBadge account={taskAccount(task)} /><SourceBadge source={task.sourceKind} />{protectedItem && <span className="protected-badge"><ShieldCheck size={12} />永不归档</span>}</div>
        <h2>{task.title}</h2><p className="drawer-summary">{task.summary}</p>
        <section className="next-panel"><span>{passive ? "保存方式" : "建议下一步"}</span><strong>{task.nextAction}</strong>{task.sourceThreadId && <button className="primary-button" onClick={() => onContinue(task)}>{continueButtonLabel(task)} <ArrowRight size={16} /></button>}</section>
        <section className="drawer-section"><h3>{passive ? "为什么存放在这里" : "为什么现在值得关注"}</h3><div className="reason-card"><Sparkles size={17} /><div><strong>{task.reason}</strong><p>{passive ? "归档和资料库只改变工作台视图，不会删除 ChatGPT 或 Codex 原对话。" : `推荐分 ${taskScore(task)}，综合近期进展、待决策、截止日期和优先级计算。`}</p></div></div></section>
        <section className="drawer-section"><h3>任务信息</h3><dl><div><dt>账号</dt><dd>{taskAccount(task)}</dd></div><div><dt>项目</dt><dd>{task.project}</dd></div><div><dt>设备</dt><dd>{task.device} · {task.hostOnline ? "在线" : "离线"}</dd></div><div><dt>最近推进</dt><dd>{getRelativeTime(task.lastActivityAt)}</dd></div><div><dt>来源</dt><dd>{sourceLabels[task.sourceKind]}</dd></div></dl></section>
        {!passive && <section className="drawer-section"><h3>改变工作状态</h3><div className="status-buttons">{regularStatuses.map((status) => { const StatusIcon = statusIcons[status]; return <button key={status} onClick={() => onUpdate({ status, completedAt: status === "done" ? new Date().toISOString() : null, reason: `手动移至${statusMeta[status].label}`, manualOverride: true }, `已移至${statusMeta[status].label}`)}><StatusIcon size={15} />{statusMeta[status].label}</button>; })}</div></section>}
      </div>
      <footer>
        {!passive && <button className="secondary-button" onClick={toggleProtection}><ShieldCheck size={16} />{protectedItem ? "恢复自动整理" : "永不归档"}</button>}
        {isAttentionTask(task) && <button className="secondary-button" onClick={() => onSnooze(task)}><TimerReset size={16} />稍后</button>}
        {isAttentionTask(task) && <button className="secondary-button" onClick={() => moveTo("reference")}><BookOpen size={16} />收为资料</button>}
        {task.status === "reference" && <button className="secondary-button" onClick={() => moveTo("archived")}><Archive size={16} />移至归档</button>}
        {task.status === "archived" && <button className="secondary-button" onClick={() => moveTo("reference")}><BookOpen size={16} />收为资料</button>}
        {passive ? <button className="primary-button" onClick={restore}><RotateCcw size={16} />重新激活</button> : <button className="primary-button" onClick={() => onDone(task)}><Check size={16} />标记完成</button>}
      </footer>
    </aside>
  </>;
}

function ChatGPTImportModal({ busy, progress, defaultAccount, onClose, onSubmit }: {
  busy: boolean;
  progress: number;
  defaultAccount: string;
  onClose: () => void;
  onSubmit: (file: File, accountAlias: string) => void;
}) {
  const [accountAlias, setAccountAlias] = useState(defaultAccount === "账号2" ? "账号2" : "账号1");
  const [file, setFile] = useState<File | null>(null);
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (file && !busy) onSubmit(file, accountAlias);
  };
  return (
    <>
      <button className="modal-backdrop" onClick={onClose} aria-label="关闭 ChatGPT 导入" />
      <div className="modal chatgpt-import-modal">
        <header><div><span className="eyebrow">第一次建立云端索引</span><h2>导入 ChatGPT 历史</h2></div><button className="icon-button" onClick={onClose} disabled={busy} aria-label="关闭"><X size={19} /></button></header>
        <form onSubmit={handleSubmit}>
          <label>这些对话属于哪个账号<select value={accountAlias} onChange={(event) => setAccountAlias(event.target.value)} disabled={busy}><option>账号1</option><option>账号2</option></select></label>
          <label className="history-file-picker"><FileJson size={22} /><span><strong>{file ? file.name : "选择 conversations.json"}</strong><small>从 ChatGPT 数据导出文件中解压得到；重复导入只更新变化内容。</small></span><input type="file" accept="application/json,.json" onChange={(event) => setFile(event.target.files?.[0] ?? null)} disabled={busy} /></label>
          <div className="pairing-note"><Globe2 size={18} /><div><strong>系统会找出仍有下一步的旧对话</strong><p>每批只发送最后四轮给状态模型；完整聊天不会保存在 Threadline，也不会重复分析没有变化的内容。</p></div></div>
          {busy && <div className="import-progress"><span style={{ width: `${Math.max(4, progress)}%` }} /><small>{progress}% · 正在分批整理</small></div>}
          <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose} disabled={busy}>取消</button><button className="primary-button" type="submit" disabled={!file || busy}>{busy ? <LoaderCircle size={16} className="spin" /> : <Upload size={16} />}{busy ? "正在统一整理" : "开始导入并判断"}</button></div>
        </form>
      </div>
    </>
  );
}

function AddDeviceModal({
  busy,
  onClose,
  onSubmit,
}: {
  busy: boolean;
  onClose: () => void;
  onSubmit: (deviceName: string, accountAlias: string) => void;
}) {
  const [deviceName, setDeviceName] = useState("");
  const [accountAlias, setAccountAlias] = useState("账号1");
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (deviceName.trim().length < 2 || busy) return;
    onSubmit(deviceName.trim(), accountAlias);
  };
  return (
    <>
      <button className="modal-backdrop" onClick={onClose} aria-label="关闭设备连接" />
      <div className="modal device-modal">
        <header><div><span className="eyebrow">一次连接，持续同步</span><h2>添加一台电脑</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={19} /></button></header>
        <form onSubmit={handleSubmit}>
          <label>设备名称<input autoFocus value={deviceName} onChange={(event) => setDeviceName(event.target.value)} placeholder="例如：办公室台式机" minLength={2} maxLength={48} required /></label>
          <label>这台电脑使用的账号<select value={accountAlias} onChange={(event) => setAccountAlias(event.target.value)}><option>账号1</option><option>账号2</option></select></label>
          <div className="pairing-note"><Monitor size={18} /><div><strong>下载后，在对应电脑运行一次</strong><p>打开“下载”文件夹，在地址栏输入 <code>powershell</code> 并回车；然后执行：<code>powershell -ExecutionPolicy Bypass -File &quot;.\下载的脚本名.ps1&quot;</code></p><p>安装成功后会每 15 分钟自动同步。看到绿色“Threadline 已连接”后即可关闭窗口，并删除下载的安装脚本。</p></div></div>
          <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" type="submit" disabled={busy}>{busy ? <LoaderCircle size={16} className="spin" /> : <Download size={16} />}{busy ? "正在生成" : "下载连接脚本"}</button></div>
        </form>
      </div>
    </>
  );
}

function AddTaskModal({ projects, accounts, defaultAccount, onClose, onSubmit }: { projects: string[]; accounts: string[]; defaultAccount: string; onClose: () => void; onSubmit: (task: Task) => void }) {
  const [title, setTitle] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [project, setProject] = useState(projects[0] ?? "个人");
  const [accountAlias, setAccountAlias] = useState(defaultAccount);
  const handleSubmit = (event: FormEvent) => { event.preventDefault(); if (!title.trim() || !nextAction.trim()) return; const now = new Date().toISOString(); onSubmit({ id: `manual-${Date.now()}`, sourceThreadId: null, sourceKind: "manual", accountAlias, title: title.trim(), summary: "手动添加的任务", nextAction: nextAction.trim(), status: "inbox", priority: "medium", project, device: "任意设备", hostOnline: true, unread: false, score: 55, reason: "新加入收件箱", dueAt: null, snoozedUntil: null, lastActivityAt: now, createdAt: now, completedAt: null, tags: [] }); };
  return <><button className="modal-backdrop" onClick={onClose} aria-label="关闭新建任务" /><div className="modal"><header><div><span className="eyebrow">快速收集</span><h2>添加任务</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={19} /></button></header><form onSubmit={handleSubmit}><label>任务标题<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：验证新版登录流程" required /></label><label>明确的下一步<input value={nextAction} onChange={(event) => setNextAction(event.target.value)} placeholder="例如：在测试手机上登录一次" required /></label><label>所属账号<select value={accountAlias} onChange={(event) => setAccountAlias(event.target.value)}>{accounts.map((name) => <option key={name}>{name}</option>)}</select></label><label>所属项目<select value={project} onChange={(event) => setProject(event.target.value)}>{projects.map((name) => <option key={name}>{name}</option>)}<option>个人</option></select></label><div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" type="submit"><Plus size={16} />加入收件箱</button></div></form></div></>;
}
