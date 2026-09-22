# Threadline AI Inbox

> 把散落在 Codex、ChatGPT 和多台电脑里的 AI 对话，变成一个只需要审批和决策的工作收件箱。

[English summary](#english-summary) · [本地体验](#五分钟本地体验) · [云端部署](#部署到-cloudflare) · [常见问题](#已经踩过的坑) · [隐私](docs/privacy.md)

![Threadline overview](public/og.png)

Threadline 面向同时处理许多 AI 对话的人。它不会要求你重新阅读所有窗口，而是持续识别哪些任务在运行、哪些在等你拍板、哪些值得继续，以及哪些已经可以结束。

> **项目状态：Alpha。** 这是从真实个人工作流中抽离出的首个社区版本，接口和数据结构仍可能变化。请先使用测试数据，不要直接暴露到公网。

## 为什么做这个项目

当 Codex、ChatGPT 和多台电脑同时工作时，困难往往不是“AI 不够聪明”，而是人无法持续记住几十个对话的状态。Threadline 把这些对话压缩成：

- 最多 3 个今天最值得处理的决定。
- 一个最多约 40 项的活跃工作集。
- 待我处理、AI 处理中、建议继续、等待中和已完成等状态。
- 可搜索、可恢复的历史任务，而不是不可逆删除。

## 当前能力

- Codex 本地任务只读采集与定时同步。
- ChatGPT 网页连接器与历史回填实验功能。
- 多设备、双账号和项目筛选。
- D1 持久化、来源去重和人工状态优先。
- OpenAI-compatible 模型接口，可选 BYOK 智能分类和领导摘要。
- 没有模型密钥时自动退回本地规则判断。
- Windows 优先的安装脚本和 JSON 备份入口。

## 这次究竟开源了什么

公开仓库包含一套可以独立运行的 Community Edition：

| 已公开 | 具体内容 |
| --- | --- |
| 工作台前端 | 今日优先项、状态看板、任务控制台、搜索及账号/设备/来源筛选 |
| 服务端 API | 任务读写、设备配对、设备同步、ChatGPT 导入和领导摘要 |
| 数据层 | Cloudflare D1 schema、7 个数据库迁移和本地模拟配置 |
| Codex 连接器 | 只读 Python 采集器、Windows 定时任务安装/卸载脚本 |
| ChatGPT 连接器 | Tampermonkey 用户脚本生成器、当前对话同步和历史回填实验功能 |
| AI 判断 | OpenAI-compatible BYOK 状态分类、下一步建议和全局摘要 |
| 工程文件 | 测试、虚构演示数据、隐私文档、安全策略和贡献指南 |

以下内容**没有公开**：你的生产数据库、两三千条真实对话、ChatGPT/Codex 凭据、设备令牌、模型 API Key、生产站点项目 ID、私人域名以及原生产仓库的 Git 历史。别人部署后得到的是自己的空白/演示实例，不会看到你的工作台内容。

## 五分钟本地体验

需要 Node.js 22.13+。本地开发使用 Cloudflare D1 的模拟环境。

```powershell
git clone https://github.com/SmallHorseBrother/threadline-ai-inbox.git
cd threadline-ai-inbox
npm install
npm run db:local
npm run dev
```

打开终端显示的本地地址。首次访问会写入一组完全虚构的演示任务。

AI 功能是可选的。如果需要启用，将 `.env.example` 复制为 `.dev.vars`，填写自己的 OpenAI-compatible API 配置：

```powershell
Copy-Item .env.example .dev.vars
```

请勿提交 `.dev.vars`、设备配对文件、导出的任务快照或任何真实对话数据。

本地模式适合体验 UI 和规则逻辑。Codex/ChatGPT 自动连接需要一个可被其他电脑和浏览器访问的 HTTPS 地址，因此建议部署到云端后再安装连接器。

## 部署到 Cloudflare

当前社区版使用 Cloudflare Workers + D1，不是普通的静态 Next.js 网站。经过验证的最短流程是：

```powershell
npx wrangler login
npx wrangler d1 create threadline-ai-inbox
# 把上一步返回的 database_id 填入 wrangler.jsonc
npx wrangler d1 migrations apply threadline-ai-inbox --remote
npm run build
npx wrangler deploy --dry-run
npx wrangler deploy
```

部署后必须使用 Cloudflare Access 保护管理界面；机器同步路径 `/api/device-sync` 和 `/agent/*` 需要单独建立 Bypass 策略，它们仍由独立设备令牌保护。需要 AI 判断时，再设置自己的密钥：

```powershell
npx wrangler secret put THREADLINE_ANALYSIS_API_KEY
```

默认模型配置是 DeepSeek 官方 OpenAI-compatible 接口。使用其他中转站或模型时，再设置 `THREADLINE_ANALYSIS_BASE_URL` 和 `THREADLINE_ANALYSIS_MODEL`。不配置模型也能使用，系统会自动退回规则判断。

更详细的说明见 [自托管文档](docs/self-hosting.md)。

## 连接自己的设备和账号

1. 云端部署并登录工作台。
2. 打开“同步与提醒”，添加一台电脑并选择账号别名。
3. 在对应 Windows 电脑运行下载的 PowerShell 安装脚本；之后计划任务默认每 15 分钟同步一次。
4. 如果要同步 ChatGPT 网页，在**登录着目标 ChatGPT 账号的浏览器配置**中安装生成的 Tampermonkey 脚本。
5. 安装用户脚本后刷新 ChatGPT 页面。增量同步只采集之后打开或变化的对话；旧记录使用“一键回填历史”。

“账号1/账号2”目前只是 Threadline 内部的数据分组别名，与 ChatGPT Pro 订阅、Codex 额度或电脑登录权限没有绑定关系。

## 已经踩过的坑

- **收到 Vercel 的 “New project available to import” 邮件**：这只表示 Vercel 发现了 GitHub 中的 Next.js 仓库，不表示已经部署。当前版本依赖 Cloudflare D1，不能直接一键导入 Vercel。
- **本地启动时报 `no such table`**：漏跑了 `npm run db:local`。
- **云端迁移失败或找不到数据库**：`wrangler.jsonc` 仍然是占位 `database_id`，或者忘记给迁移命令加 `--remote`。
- **工作台云端返回 401**：本地免登录只对 localhost 生效；云端必须配置 Cloudflare Access。
- **设备脚本连不上**：检查云端必须是 HTTPS，并确认 Access 已绕过 `/api/device-sync` 和 `/agent/*`。
- **PowerShell 出现中文乱码或字符串缺少终止符**：重新下载最新版脚本，用 `powershell -ExecutionPolicy Bypass -File ".\脚本名.ps1"` 运行，不要复制旧脚本内容到记事本后再保存。
- **Tampermonkey 显示脚本已启用但没有数据**：确认脚本安装在登录目标账号的同一个浏览器配置中，然后刷新 ChatGPT 具体对话页面。
- **历史回填很慢**：它会分批读取并上传，浏览器需要保持登录和页面打开；网页结构变化时可能出现部分失败。
- **AI 摘要没有出现**：API Key 是可选配置；未配置、模型名错误或接口不兼容时会回退到规则摘要。

完整排错手册见 [docs/troubleshooting.md](docs/troubleshooting.md)。

## 隐私边界

- Codex 采集器默认读取任务元数据；语义分析只发送有限的首轮和最近对话片段。
- ChatGPT 网页连接器运行在用户浏览器中，需要用户主动安装。
- API 密钥只应保存在部署环境变量中。
- 设备令牌只保存哈希；下载的配对文件仍属于敏感凭据。
- 本仓库只包含虚构演示数据，不包含生产数据库或私人 Git 历史。

完整说明见 [docs/privacy.md](docs/privacy.md)。

## 路线图

- 通用账号管理，不再限制两个固定别名。
- 冷热分层：活跃、候选、资料库和可恢复归档。
- Docker Compose 与 SQLite 单机版。
- 更多 AI 客户端和协作工具连接器。
- 更细的模型成本、数据保留和审计控制。
- 英文界面与无障碍改进。

## 参与贡献

欢迎提交 Issue、讨论和 Pull Request。开始前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。安全漏洞请不要公开提交 Issue，处理方式见 [SECURITY.md](SECURITY.md)。

## 许可证

Apache License 2.0。详见 [LICENSE](LICENSE)。

Threadline AI Inbox 是独立社区项目，与 OpenAI、ChatGPT 或 Codex 官方没有隶属或背书关系。

## English summary

Threadline AI Inbox turns scattered Codex and ChatGPT conversations into a decision-focused work inbox. It highlights tasks that need your input, agents that are still running, stalled work worth resuming, and conversations that can be safely closed.

The first community release is an alpha focused on local, single-user use with Cloudflare D1 emulation. Optional AI classification works with OpenAI-compatible APIs and BYOK credentials. See the Chinese sections above for setup, privacy boundaries, and the roadmap.
