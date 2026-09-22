# 验证结果

验证日期：2026-09-08（Asia/Shanghai）

验证只读取当前用户目录下的 `.codex`。报告没有保存或展示真实标题、thread id、消息正文、工作目录、工具参数或终端输出。

## 数据源勘探

| 来源 | 只读观察结果 | 原型用途 |
|---|---:|---|
| `state_5.sqlite / threads` | 482 行；其中 329 个子代理线程，153 个非子代理线程；7 个归档行；481 行有标题 | 首选线程元数据 |
| `goals_1.sqlite / thread_goals` | 5 行；3 个 `active`，2 个 `blocked`；均关联非子代理线程 | 高置信度状态 |
| `session_index.jsonl` | 152 个唯一线程索引 | 标题/时间回退 |
| `sessions` + `archived_sessions` | 482 个唯一 rollout 线程 | 存在性、归档与时间回退 |
| `sqlite/codex-dev.db` | 存在本地 catalog、automation、inbox 等表；当前 catalog 与 inbox 均为空 | 本轮不作为线程来源 |

另发现 `logs_2.sqlite`、`memories_1.sqlite` 和会话正文均可能含大量敏感内容。原型明确不读取它们。

## 真实数据红acted导出

以 `--redact-titles` 和固定测试设备 id 运行内存导出，结果为：

```text
kind: codex_task_snapshot
tasks: 153
status_counts:
  active: 9
  archived: 6
  in_progress: 3
  needs_attention: 2
  suggested_next: 133
excluded_subagent_threads: 329
```

安全断言全部通过：

```text
cwd field present: false
preview field present: false
first_user_message field present: false
objective field present: false
rollout_path field present: false
all titles redacted: true
all task ids unique: true
```

`state_5.sqlite` 有 7 个归档行，而最终用户任务为 6 个归档，原因是默认过滤掉了子代理线程。

## 自动化测试

命令：

```powershell
python -m py_compile .\codex_task_sync.py .\test_sync.py
python -m unittest -v
```

结果：9 个测试全部通过，覆盖：

- 显式 blocked goal 的高优先级处理。
- 归档与完成严格区分。
- 陈旧线程进入建议继续。
- 中文状态标题标记。
- 多设备同线程的新版本获胜和设备并集。
- 无效 schema 拒绝。
- 禁止写入 `CODEX_HOME`。
- JSON 快照往返读取。
- 目录输入展开。

四个 JSON 文件均通过标准库解析；两个虚构设备快照合并后得到 3 条任务，状态计数与 `samples/merged.json` 一致，共享线程的 `observation_count` 为 2。

## 已知边界

- 本地 SQLite 和 JSONL 是 Codex 实现数据，版本升级后字段可能变化；脚本已做列探测和回退，但仍需持续回归测试。
- “建议继续”是基于置顶和时间的保守启发式，不是对消息语义的 AI 判断。
- 没有明确 goal 或标题标记时，脚本不会武断地宣称任务完成。
- 若两台电脑上的独立本地线程碰巧讨论同一事项，它们仍会保留为两条任务；自动按标题合并会带来更危险的误合并。
