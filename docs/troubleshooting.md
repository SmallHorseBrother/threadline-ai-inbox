# Troubleshooting

这里记录 Threadline 从个人原型变成社区版本过程中已经遇到的真实问题。先检查症状，再执行对应操作。

## 收到 Vercel 的导入邮件

邮件标题通常是 `New project available to import`。这是 Vercel 的 GitHub 集成发现了一个 Next.js 仓库后发送的部署邀请：

- 不表示项目已经部署；
- 不表示 GitHub 泄露或构建失败；
- 点击后会在 Vercel 创建一个新项目；
- 当前 Threadline 依赖 Cloudflare D1 和 Worker binding，Vercel 不会自动提供这些资源。

因此当前版本应忽略这封邮件，按 [self-hosting.md](self-hosting.md) 部署到 Cloudflare。未来如增加 Postgres/SQLite adapter 和 Vercel runtime adapter，才适合提供 Vercel 一键部署。Vercel 官方也说明，导入 Git 仓库后才会创建项目并触发后续自动部署，参见 [Deploying Git Repositories with Vercel](https://vercel.com/docs/git)。

## `no such table: tasks`

本地漏执行：

```powershell
npm run db:local
```

云端漏执行：

```powershell
npx wrangler d1 migrations apply threadline-ai-inbox --remote
```

## `No migrations folder found`

确认 `wrangler.jsonc` 的 D1 配置包含：

```jsonc
"migrations_dir": "drizzle"
```

## `DB assigned to multiple D1 Database bindings`

这通常表示同时在 `vite.config.ts` 和 `wrangler.jsonc` 手动声明了 `DB`。社区版只在 `wrangler.jsonc` 声明；更新到最新版后重新运行 `npm run build`。

## 本地端口 3000 已被占用

Vite 会自动尝试 3001、3002 等端口。以终端最终显示的 `Local:` 地址为准。

## 云端页面能打开，但 API 返回 401

localhost 才允许免登录。公网需要 Cloudflare Access，并由它注入 `cf-access-authenticated-user-email`。不要为了消除 401 而删除服务端身份检查。

## 工作台可以登录，但设备一直离线

逐项检查：

1. 站点 URL 是否为 HTTPS；
2. Cloudflare Access 是否绕过 `/api/device-sync` 和 `/agent/*`；
3. `%LOCALAPPDATA%\Threadline\Agent` 中是否存在对应设备目录；
4. Windows 任务计划程序中是否存在 `Threadline Cloud Sync - 设备ID`；
5. 手工运行设备目录中的 `run-threadline-cloud-sync.ps1` 查看错误。

## PowerShell 报“字符串缺少终止符”或中文乱码

早期脚本曾因 Windows PowerShell 5.1 对无 BOM UTF-8 的识别方式出现乱码。最新版下载文件已经包含 BOM。请重新下载，不要继续复用旧文件，也不要在记事本中复制粘贴后另存为 ANSI。

在下载目录地址栏输入 `powershell`，然后执行：

```powershell
powershell -ExecutionPolicy Bypass -File ".\实际脚本文件名.ps1"
```

文件名使用中文或英文都可以，关键是文件编码和命令中的文件名一致。

## Tampermonkey 显示“脚本尚未执行”

- 确认当前页面是 `https://chatgpt.com/...`；
- 刷新具体对话页面；
- 确认用户脚本和 Tampermonkey 总开关均为启用；
- 脚本必须安装在登录目标账号的同一个 Chrome/Edge 配置中；
- 安装在账号1浏览器中的脚本不会自动读取账号2浏览器的数据。

## ChatGPT 设备在线，但对话数量是 0

设备在线只证明脚本发出了心跳，不证明已经读取到具体对话。打开一个具体 ChatGPT 对话并刷新，等待几秒后检查。历史记录需要另行点击“一键回填”。

## 历史回填读取到目录，但成功数是 0

ChatGPT 网页结构和内部接口会变化。先确认使用最新脚本，然后：

1. 刷新 ChatGPT 页面；
2. 保持当前账号登录；
3. 重新点击失败项；
4. 观察失败原因是否是正文为空、401/403 或上传失败。

历史回填会按批次处理，浏览器需要保持打开。界面中的失败数字可能包含上一轮累计失败数，最终结果以“已完成/部分完成”和工作台实际收录数量为准。

## AI 智能汇报没有工作

- 未配置 Key 时是正常的，系统会显示规则摘要；
- 确认接口兼容 OpenAI Chat Completions；
- 确认 URL 不要重复写 `/v1/chat/completions`；
- 确认模型名确实由供应商提供；
- 修改云端密钥后重新部署或等待 Worker 配置生效。

## 为什么别人部署后看不到我的两三千条对话

这是正确行为。GitHub 只包含程序和虚构演示数据，不包含你的生产 D1 数据库。每个部署者都必须连接自己的设备和账号，数据空间相互独立。

## 安全提醒

不要在公开 Issue 中粘贴：

- `.dev.vars`；
- 设备配对 JSON；
- Tampermonkey 脚本中的令牌；
- 完整聊天导出；
- Cloudflare Access 凭据；
- 模型 API Key。

安全漏洞请使用 GitHub 的 Private vulnerability reporting。
