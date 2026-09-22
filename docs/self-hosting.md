# Self-hosting

Threadline Community Edition 当前支持本地单用户体验和 Cloudflare Workers + D1 云端部署。生产版仍处于 Alpha，建议先使用测试账号和测试数据。

## 1. 本地运行

环境要求：

- Node.js 22.13 或更新版本；
- Git；
- Windows 设备连接器还需要 Python 3；
- 不需要模型 API Key。

```powershell
git clone https://github.com/SmallHorseBrother/threadline-ai-inbox.git
cd threadline-ai-inbox
npm install
npm run db:local
npm run dev
```

打开终端显示的 `http://localhost:端口`。首次访问会创建虚构演示任务。

本地地址使用免登录的 `local-user` 身份，只有 `localhost`、`127.0.0.1` 和 `::1` 会启用这一行为。不要通过路由器端口映射把开发服务器直接暴露到公网。

## 2. 可选的 AI 配置

```powershell
Copy-Item .env.example .dev.vars
```

编辑 `.dev.vars`：

```dotenv
THREADLINE_ANALYSIS_API_KEY=你的密钥
THREADLINE_ANALYSIS_BASE_URL=https://api.deepseek.com
THREADLINE_ANALYSIS_MODEL=deepseek-chat
```

接口需兼容 OpenAI `POST /v1/chat/completions`。没有密钥、接口失败或模型返回格式不正确时，Threadline 会使用规则判断，不会阻止任务同步。

## 3. 创建 Cloudflare D1

先登录 Cloudflare：

```powershell
npx wrangler login
npx wrangler whoami
```

创建数据库：

```powershell
npx wrangler d1 create threadline-ai-inbox
```

命令会返回真实的 `database_id`。把它替换到 `wrangler.jsonc`：

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "threadline-ai-inbox",
    "database_id": "这里填写 Cloudflare 返回的真实 ID",
    "migrations_dir": "drizzle"
  }
]
```

不要提交包含真实数据库 ID 的修改；可以保留在私人分支，或在部署流水线中生成配置。

## 4. 执行远端迁移

```powershell
npx wrangler d1 migrations apply threadline-ai-inbox --remote
```

`npm run db:local` 只更新本机模拟数据库，不能替代上面的远端迁移。

## 5. 构建和部署

```powershell
npm run check
npm run build
npx wrangler deploy --dry-run
npx wrangler deploy
```

`--dry-run` 会验证 Worker、静态资源和 D1 binding，但不会发布。确认它列出一个 `env.DB (threadline-ai-inbox)` 后再正式部署。

部署到 `workers.dev` 或自定义域名后，设备 API 默认会使用当前请求的 HTTPS origin。只有反向代理后的外部地址与请求 origin 不一致时，才需要设置：

```powershell
npx wrangler secret put THREADLINE_SITE_URL
```

## 6. 设置模型密钥

```powershell
npx wrangler secret put THREADLINE_ANALYSIS_API_KEY
```

非敏感变量可以在 Cloudflare 控制台中设置，或加入你自己的私有 Wrangler 配置：

- `THREADLINE_ANALYSIS_BASE_URL`
- `THREADLINE_ANALYSIS_MODEL`
- `THREADLINE_SITE_URL`

`THREADLINE_SITES_BYPASS_TOKEN` 只用于还需要额外机器访问令牌的托管平台；普通 Cloudflare Workers 部署留空。

## 7. 配置 Cloudflare Access

公网管理界面必须由 Cloudflare Access 或等价的可信身份代理保护。Threadline 接受以下由可信代理注入的身份头：

- `cf-access-authenticated-user-email`
- `oai-authenticated-user-id`
- `oai-authenticated-user-email`

建议策略：

1. 对整个站点设置只允许自己邮箱访问的 Access policy。
2. 为 `/api/device-sync` 设置 Bypass policy；该接口仍要求独立设备令牌。
3. 为 `/agent/*` 设置 Bypass policy，使安装脚本可以下载只读采集器。
4. 不要绕过 `/api/tasks`、`/api/devices` 或管理页面。

如果使用其他反向代理，必须在边缘层删除客户端伪造的同名身份头，再写入经过验证的身份。

## 8. 安装设备连接器

1. 登录云端 Threadline。
2. 进入“同步与提醒”。
3. 添加设备，下载 PowerShell 安装脚本。
4. 在对应电脑的下载目录打开 PowerShell：

```powershell
powershell -ExecutionPolicy Bypass -File ".\下载的脚本名.ps1"
```

安装器会把采集器和配对文件放在 `%LOCALAPPDATA%\Threadline\Agent\设备ID`，并创建每 15 分钟执行一次的 Windows 计划任务。配对文件包含敏感设备令牌，不要分享。

## 9. 安装 ChatGPT 网页连接器

ChatGPT 连接器必须安装在**实际登录目标 ChatGPT 账号的浏览器配置**中：

1. 安装 Tampermonkey。
2. 在 Threadline 为该网页账号生成并下载用户脚本。
3. 用 Tampermonkey 安装脚本并确认启用。
4. 刷新 `chatgpt.com` 的具体对话页面。
5. 当前对话会增量同步；旧对话使用页面右下角的历史回填面板。

不同浏览器配置和不同 ChatGPT 账号需要各自安装对应脚本。某台电脑关机只会暂停该设备的新数据采集，不会删除已上传的数据。

## 10. 升级

```powershell
git pull
npm install
npx wrangler d1 migrations apply threadline-ai-inbox --remote
npm run check
npm run build
npx wrangler deploy
```

数据库升级前建议先导出备份。不要把生产数据库、`.dev.vars` 或设备配对文件复制回公开仓库。

## 官方参考

- [Cloudflare Vite plugin](https://developers.cloudflare.com/workers/vite-plugin/get-started/)
- [Cloudflare Access application paths](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/)
- [Cloudflare Access policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/)
