# Contributing

感谢你帮助改进 Threadline AI Inbox。

## 开始之前

1. 先搜索现有 Issue，避免重复工作。
2. 较大的功能请先开 Discussion 或 Issue 说明使用场景。
3. 不要上传真实聊天记录、设备令牌、本机路径、账号邮箱或 API 密钥。

## 本地开发

```powershell
npm install
npm run db:local
npm run dev
```

提交前运行：

```powershell
npm run check
python tools/thread-sync/test_sync.py
```

## Pull Request 要求

- 一个 PR 尽量只解决一个问题。
- 写清楚用户可见变化、测试方式和隐私影响。
- 新增采集字段时同步更新 `docs/privacy.md`。
- UI 改动请附截图；数据库改动请提交 Drizzle migration。
- 新连接器必须默认最小化采集，并允许用户关闭。

提交代码即表示你同意按 Apache-2.0 许可证贡献这些修改。
