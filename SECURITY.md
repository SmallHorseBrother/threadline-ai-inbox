# Security Policy

## Supported versions

当前项目仍处于 Alpha，只对最新的 `main` 分支提供安全修复。

## Reporting a vulnerability

请不要公开披露可能泄露聊天内容、设备令牌、API 密钥或绕过身份验证的问题。

请通过 GitHub 仓库的 **Security → Report a vulnerability** 私下报告。如果该入口尚未启用，请联系仓库维护者，并只描述复现所需的最少信息；不要附带真实对话或有效凭据。

我们会尽力在 7 天内确认收到报告，并在确认影响后协调修复和披露时间。

## Deployment warning

Threadline 会处理敏感工作元数据。公网部署必须放在 Cloudflare Access 或等价的可信身份代理之后。不要把 `.dev.vars`、设备配对 JSON、用户脚本或导出的任务快照提交到 Git。
