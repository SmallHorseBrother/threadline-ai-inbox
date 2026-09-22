# Self-hosting

## Local development

```powershell
npm install
npm run db:local
npm run dev
```

本地地址使用免登录的 `local-user` 身份。只有 `localhost`、`127.0.0.1` 和 `::1` 会启用这一行为。

## Optional AI configuration

复制 `.env.example` 为 `.dev.vars`，填写自己的 OpenAI-compatible API。密钥缺失或上游不可用时，系统自动使用规则摘要。

## Cloudflare Workers + D1

云端部署仍属于 Alpha。请在测试账号中完成以下步骤：

1. 创建数据库：`npx wrangler d1 create threadline-ai-inbox`。
2. 将返回的数据库 ID 写入 `wrangler.jsonc`。
3. 执行迁移：`npx wrangler d1 migrations apply threadline-ai-inbox --remote`。
4. 使用 `npx wrangler secret put THREADLINE_ANALYSIS_API_KEY` 保存可选模型密钥。
5. 将 `THREADLINE_SITE_URL` 设置为最终 HTTPS 地址。
6. 构建并部署：`npm run build`，然后按 Cloudflare Vite/Workers 的部署流程发布构建产物。
7. 在 Cloudflare Access 中限制允许访问的用户。

Threadline 接受 `cf-access-authenticated-user-email`、`oai-authenticated-user-id` 或 `oai-authenticated-user-email` 作为可信代理注入的身份。直接来自公网客户端的同名请求头不能被视为可信；部署者必须在边缘层剥离外部伪造头。

## Device connectors

设备连接器要求公开 HTTPS 地址。设置 `THREADLINE_SITE_URL` 后，从“同步与提醒”页面生成安装脚本。设备令牌只在创建时显示一次。

如果托管平台还要求机器访问绕过令牌，可设置 `THREADLINE_SITES_BYPASS_TOKEN`；普通 Cloudflare Workers 部署可留空。
