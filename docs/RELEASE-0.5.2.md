# ChatNoteUki 0.5.2

适配 DeepSeek 官方独立接口：`POST /v1/tools/search` 和 `POST /v1/tools/fetch`。不再通过 Anthropic 消息接口请求模型搜索工具。每条确认的查询最多 128 个 Unicode 字符，最多两次检索、四次正文读取；保留来源引用、逐字引文验证、实际选读范围、检查点和失败重试。搜索阶段按权威性、相关性优先排列线索，但搜索摘要及权威分数不会自动成为已读证据。

Search 按请求计费，不生成模型 token 用量；每次成功请求记一次检索。Fetch 同样按请求收费。既有每日模型预算设置与用户确认搜索词流程保留。

所有模型请求仅使用 `deepseek-flash`。讨论和主动认知分析取消 Pro 选项；升级前排队的 Pro 任务在请求边界统一改用 Flash，旧笔记和历史用量保留原模型标记。

无需数据迁移。API Key、原文和历史资料不改写。沿用 Windows GitHub Actions：检查、测试、构建安装包全部通过后，main 自动发布 exe 和 SHA256SUMS。

验证：145 项单元测试、类型检查、生产构建、9 项发布完整性测试通过。桌面端到端由 Windows CI 验证（应用本身限制 Windows，Linux 环境不能运行）。真实 DeepSeek 验证被开发环境代理 403 拒绝，未宣称真实 API 调用通过。

官方接口依据：https://api-docs.deepseek.com/guides/search/
