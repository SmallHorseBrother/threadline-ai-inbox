# Privacy and data flow

Threadline 的目标是减少认知负担，而不是建立一份不受控制的聊天副本。所有连接器都应遵循数据最小化原则。

## Codex collector

本地 Python 采集器读取当前用户 `.codex` 目录中的任务记录，生成任务状态、标题、更新时间、来源设备等元数据。启用语义判断时，只选择首轮与最近的有限对话片段作为分析证据，不上传完整工具输出或终端记录。

用户可以使用 `--redact-titles` 隐去标题。采集器不会修改或删除 Codex 历史。

## ChatGPT browser connector

用户脚本只在 `chatgpt.com` 页面中运行。它可以读取当前可见对话，并在用户主动触发历史回填时读取账号可访问的会话列表和有限对话片段。浏览器仍然是 ChatGPT 会话凭据的持有者；Threadline 不保存 ChatGPT 密码。

该能力依赖网页结构和非稳定接口，可能随 ChatGPT 更新而失效。安装前应阅读生成的用户脚本，并只连接到自己控制的 Threadline 实例。

## AI analysis

配置 `THREADLINE_ANALYSIS_API_KEY` 后，有限任务片段会发送到用户选择的 OpenAI-compatible 服务。未配置密钥时使用本地规则，不会调用外部模型。

## Stored data

D1 数据库可能包含：

- 任务标题、摘要、下一步和状态；
- 来源账号别名、设备名称和线程 ID；
- 经裁剪的语义分析证据与模型判断；
- 设备令牌哈希、同步时间和记录数量。

下载的设备配对文件包含可用令牌，应视为敏感凭据。数据库、备份和日志的保留周期由部署者负责。

## What is not included in this repository

公开仓库不包含生产数据库、私人任务、真实线程 ID、部署项目 ID、API 密钥、设备令牌或生产仓库的旧 Git 历史。
