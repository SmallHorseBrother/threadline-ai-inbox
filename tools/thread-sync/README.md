# Threadline 本机扫描与云同步代理

这个目录包含 Threadline 的零第三方依赖 Python 代理。它在每台 Windows 电脑上只读扫描本机 Codex 元数据，并通过 HTTPS 直接同步到云端任务板。

## 推荐：从工作台一键连接

1. 打开 Threadline 的“同步与提醒”。
2. 点击“添加设备”，填写设备名称并选择“账号1”或“账号2”。
3. 下载专属 PowerShell 安装脚本，在对应电脑运行一次。

安装脚本会把代理和设备配置保存到 `%LOCALAPPDATA%\Threadline\Agent\<设备ID>`，限制配置目录权限，创建每 15 分钟运行一次的 Windows 计划任务，并立即完成第一次同步。设备令牌只在创建时显示一次，云端仅保存其 SHA-256 摘要。撤销设备后，该令牌立即失效。

每次同步会优先为 6 个最近任务附带少量对话上下文，再轮换抽取 18 个历史任务。轮换窗口每 15 分钟前进一次，因此积压对话会逐步完成深度判断，而不会在一次同步中把上千条历史记录全部发送给模型。

三个电脑分别添加三个设备即可；它们不需要共享 OneDrive、坚果云、Dropbox、Syncthing 或 NAS 目录，也不需要保持网页打开。

## 数据边界

代理会读取线程 ID、标题、时间、归档/置顶状态、线程来源和 goal 状态等任务元数据。它不会读取或上传消息正文、工具参数、终端输出、工作目录、Git 远端、goal objective 或绝对会话路径。

本地数据源按以下顺序合并：

1. `state_*.sqlite`，以 SQLite 只读 URI 和 `PRAGMA query_only=ON` 打开。
2. `goals_*.sqlite`，只读取目标状态和数值进度。
3. `session_index.jsonl`，用于补全标题和时间。
4. `sessions/**/*.jsonl` 与 `archived_sessions/*.jsonl`，只读取开头的 `session_meta` 作为回退。

默认排除 `thread_source=subagent`。状态推断遵守以下原则：`idle` 不等于完成；归档不等于完成；明确的 blocked/completed/active goal 优先；人工在云端修改的状态优先于后续自动推断。

## 手动诊断

只看数据源数量和结构，不输出标题或线程 ID：

```powershell
python .\codex_task_sync.py inspect
```

使用工作台生成的设备配置手动触发一次上传：

```powershell
python .\codex_task_sync.py sync --config .\device.json --output .\last-snapshot.json
```

云端同步默认会为最近的最多 20 个未完成对话附带最多 4 轮经过裁剪的用户/助手文本，供低成本模型精判状态。代码块、疑似密钥、本地路径、工具参数与工具输出不会上传；使用 `--no-semantic-context` 可以关闭该能力。规则判断始终先执行，模型结果只用于细化模糊状态，且不会自动确认完成。

若标题也不能离开本机，可在安装脚本后加 `-RedactTitles`；状态板将显示匿名标题。

## 备份与离线模式

旧的 `export`、`merge`、`render_board.py`、`install-windows-sync.ps1` 和 `uninstall-windows-sync.ps1` 仍可用于完全离线或共享目录备份，但它们不是日常同步所必需。

```powershell
python .\codex_task_sync.py export --device-id laptop --account-alias "账号1" --output .\laptop.json
python .\codex_task_sync.py merge .\laptop.json .\desktop.json --output .\board.json
python .\render_board.py .\board.json --output .\board.html
```

## 验证

```powershell
python -m py_compile .\codex_task_sync.py .\test_sync.py
python -m unittest -v
```
