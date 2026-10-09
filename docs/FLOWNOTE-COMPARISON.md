# Flownote 代码对照与可借鉴设计

核对日期：2026-10-09。公开项目是 [tob124/flownote](https://github.com/tob124/flownote)，默认分支 main，核对提交 `217c5db780e37ee83c6961c250f20f9c70d105cf`，版本 3.0.0。本地完整工程 `C:\code\flownote` 的 HEAD 与该提交一致；本轮只读，没有修改 Flownote。`.local/flownote-reference` 是先前读取的部分参考文件，并非完整工程。

本次实际检查了请求客户端、任务服务、原生搜索、网页读取、片段选择、证据校验，以及 ThoughtPanel 的结果、反馈和追问入口。以下是代码观察与设计判断，不代表 Flownote 的全部功能都经过运行验收。

## 直接值得借鉴的部分

| 代码中的做法 | 对 ChatNoteUki 的意义 | 本轮状态 |
|---|---|---|
| 任务记录 `steps`，先存原始响应，再解析；重启把无法确认的请求标为 interrupted。 | 把“模型失败”和“结果尚未确认保存”分开，重试只补失败步骤。 | 0.4.0 已有响应持久化、步骤缓存和计费不明人工重试。 |
| Dream 先保存内部整理，再尝试外部补充；补充失败仍展示内部结果。 | 观察用户想法与搜集外部知识分开交付，避免一次联网失败吞掉已有分析。 | 回顾与资料分析已是不同任务；下一轮可增加从回顾继续查资料的明确入口。 |
| 资料记录读取状态、覆盖范围与 `analysis_ranges`，选读原文保存偏移。 | “发现链接”“读到摘要”“读到部分正文”需要不同标签；摘要不能冒充全文。 | 附件已有页段及覆盖范围；公开网页可进一步保存更精确的选读定位。 |
| 推荐校验逐项过滤错误出处和引文，不使其他候选一起消失。 | 放宽写作长度，同时继续严格核对真实证据。 | 对照发现外部资料分析尚有整体失败路径，本轮补齐分项保存和部分完成提示。 |
| 推荐把 `attribution: author` 和 `extension` 分开，理由、局限、阅读建议分别呈现。 | 用户应看清资料原意、AI 联系和自己的判断。 | 已有“资料依据／AI 暂定分析／局限”；下一轮推荐卡继续沿用。 |
| “有帮助／我读过了／不相关”会保存，后续计划带上近期反馈以减少重复推荐。 | 观察与推荐需要用户反馈闭环，避免重复输出看似有用但无关的建议。 | 下一轮候选 F07。需要稳定去重与可撤回反馈，而非只靠提示词。 |

相关代码：[任务与步骤](https://github.com/tob124/flownote/blob/217c5db780e37ee83c6961c250f20f9c70d105cf/src/main/services/thinking-service.ts#L157)、[Dream 分阶段保存](https://github.com/tob124/flownote/blob/217c5db780e37ee83c6961c250f20f9c70d105cf/src/main/services/thinking-service.ts#L467)、[选读片段](https://github.com/tob124/flownote/blob/217c5db780e37ee83c6961c250f20f9c70d105cf/src/main/services/source-passages.ts)、[证据校验](https://github.com/tob124/flownote/blob/217c5db780e37ee83c6961c250f20f9c70d105cf/src/main/services/evidence.ts)、[结果与反馈界面](https://github.com/tob124/flownote/blob/217c5db780e37ee83c6961c250f20f9c70d105cf/src/renderer/components/ThoughtPanel.tsx#L99)。

## AI 检索应如何继承

Flownote 的外部研究流程是：选择问题和待核查资料 → 原生联网搜索 → 读取候选网页或 PDF → 选读相关片段 → 生成推荐 → 再核对观点归属 → 本地逐项验证。它不是“模型凭印象给几本书”。页面读取有超时、体积限制、重定向次数与公开地址检查；遇到不可读页面仍保留线索。

ChatNoteUki 应继承这种来源链，但把下一步入口写得更具体：在笔记或回顾内选择“查找支持或相反的资料”，先确认问题、关键词与范围；结果分别呈现已核对依据、AI 联系、未取得正文的线索。读完可以记录自己的补充想法，仍由用户决定是否修改认知。搜索结果不自动成为用户立场，也不自动写入已确认认知。

检索实现参考：[研究流程](https://github.com/tob124/flownote/blob/217c5db780e37ee83c6961c250f20f9c70d105cf/src/main/services/thinking-service.ts#L309)、[原生搜索](https://github.com/tob124/flownote/blob/217c5db780e37ee83c6961c250f20f9c70d105cf/src/main/services/deepseek-search.ts)、[网页读取](https://github.com/tob124/flownote/blob/217c5db780e37ee83c6961c250f20f9c70d105cf/src/main/services/source-reader.ts)。

## 需要改进后借鉴的部分

这些是代码推导出的风险，未声称已在 Flownote 实机复现：

- 请求端仍按字符截取 64,000 字符，材料准备另有每条截取和摘要截取。适合明确提示覆盖范围，但不能替代 token 预算与可恢复分段。ChatNoteUki 保留本轮官方 tokenizer 与分段检查点。
- `generate` 缺失 usage 时记 0；HTTP 错误只展示状态码。ChatNoteUki 保留用量待核对／估计占用，以及鉴权、余额、限流等不同处理方式。
- 多数正文通过 `clean` 截取，格式所需字段从提示词正则提取。ChatNoteUki 使用明确结构定义，并保留完整有效文字，长度只作为写作和预览目标。
- 逐字引文确实存在，只能证明“这段文字来自已读来源”；`supports_claim` 和第二次 AI 核查不能数学上证明论证成立。用户仍需看到局限并能打开上下文，不能把“核对通过”写成事实保证。
- 片段选择使用关键词评分，长中文查询拆双字片段，有助于低成本定位，但缺少命中说明和意义层面的质量评估。下一轮先改进中文检索与明确范围，再决定是否引入语义模型。
- 推荐评分门槛适合特定阅读偏好，不宜直接硬编码成所有思想分析的筛选标准；小众资料可能重要，评价人数不能代替具体相关性与证据质量。
- `read`／`irrelevant` 近期反馈只随提示词传入，可能跨问题压制不同用途的同一本资料。应按问题、推荐依据和来源版本记录反馈，可撤回；有新增证据时明确说明为何再次出现。

请求实现：[thinking-client.ts](https://github.com/tob124/flownote/blob/217c5db780e37ee83c6961c250f20f9c70d105cf/src/main/llm/thinking-client.ts)。这些判断用于下一轮设计，不自动迁移 Flownote 数据，也不改变它的工程。

## 本轮对照后实际补齐

ChatNoteUki 外部资料分析现在逐项验证字段和真实引文，保留有效分析、有效依据及完整长文字，错误条目标为未采用，任务和卡片显示部分完成。主要字段格式错误仍走现有有限修复流程；未读资料和编造片段仍不能成为证据。应用结果前重新检查正文、更正版本、删除、归属、结构与认知基础，防止在生成期间修改了内容后又应用旧结果。

新增模拟回归覆盖“有效引用与编造引用混合、长分析、事件重放”及“生成期间更正正文”。没有增加真实 API 调用。未来产品候选见 [下一轮候选卡](NEXT-FEATURE-CANDIDATES.md)。
