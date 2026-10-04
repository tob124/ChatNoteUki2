// Explicit opt-in: public synthetic question, one Flash search and one Flash analysis.
import { app } from "electron";
import { join, resolve, sep } from "node:path";
import { researchReportSchema } from "../src/research";
import { mkdirSync, writeFileSync } from "node:fs";
import { Credentials } from "../electron/credentials";
import { Store } from "../electron/store";
import {
  AiQueue,
  DeepSeek,
  safeAiError,
  type AiTransport,
} from "../electron/ai";
import {
  DeepSeekSearch,
  type ResearchSearch,
} from "../electron/research-search";
import { settingsSchema } from "../src/shared";
app
  .whenReady()
  .then(async () => {
    const report = {
      passed: false,
      searchCalls: 0,
      analysisCalls: 0,
      input: 0,
      output: 0,
      serverSearches: 0,
      readSources: 0,
      findings: 0,
      error: "",
      formatIssues: [] as string[],
      shape: {} as Record<string, string>,
    };
    const resume = process.argv
      .find((arg) => arg.startsWith("--resume="))
      ?.slice(9);
    const folder = resume
      ? resolve(resume)
      : resolve(".local", `live-research-${Date.now()}`);
    if (!folder.startsWith(resolve(".local") + sep))
      throw new Error("真实验证仅使用 .local 隔离目录");
    mkdirSync(folder, { recursive: true });
    const store = new Store(join(folder, "thoughts.db"));
    try {
      const credentials = new Credentials(
        process.env.UKI_LIVE_CREDENTIALS_PATH ??
          join(app.getPath("appData"), "ChatNoteUki", "credentials.json"),
      );
      const key = credentials.apiKey();
      if (!key)
        throw new Error("指定本机资料目录未保存 DeepSeek key，未执行真实测试");
      const network = new DeepSeek(),
        discovery = new DeepSeekSearch();
      const transport: AiTransport = {
        complete: async (secret, model, system, context, maxOutput, signal) => {
          if (
            model !== "deepseek-flash" ||
            report.analysisCalls >= 1 ||
            report.output + maxOutput > 4000
          )
            throw new Error("真实验证调用预算已到上限");
          report.analysisCalls++;
          const result = await network.complete(
            secret,
            model,
            system,
            context,
            maxOutput,
            signal,
          );
          report.input += result.input;
          report.output += result.output;
          try {
            const value = JSON.parse(result.content);
            report.shape = Object.fromEntries(
              Object.entries(value).map(([key, v]) => [
                key,
                Array.isArray(v) ? "array" : typeof v,
              ]),
            );
            const parsed = researchReportSchema.safeParse(value);
            if (!parsed.success)
              report.formatIssues = parsed.error.issues.map(
                (issue) => `${issue.path.join(".")}: ${issue.code}`,
              );
          } catch {
            report.formatIssues = ["invalid JSON"];
          }
          return result;
        },
      };
      const search: ResearchSearch = {
        search: async (secret, query, onResponse, signal) => {
          if (report.searchCalls >= 1)
            throw new Error("本轮只允许一次真实搜索");
          report.searchCalls++;
          return discovery.search(
            secret,
            query,
            (usage) => {
              report.input += usage.input;
              report.output += usage.output;
              report.serverSearches += usage.searches;
              onResponse(usage);
            },
            signal,
          );
        },
      };
      const oldTask = resume
        ? store.tasks().find((t) => t.kind === "research")
        : undefined;
      const noteId =
        oldTask?.research?.noteId ??
        store.capture({
          raw: "公开合成样例：想了解步行或骑车通勤与心理健康的研究，区分相关性和因果关系。",
        });
      store.append("note.failed", {
        id: noteId,
        error: "验证只运行主动研究，不运行笔记分类",
      });
      const queue = new AiQueue(
        store,
        { apiKey: () => key, settings: () => settingsSchema.parse({}) },
        () => {},
        transport,
        search,
      );
      if (oldTask)
        store.append("task.updated", {
          id: oldTask.id,
          status: "pending",
          error: null,
        });
      const taskId =
        oldTask?.id ??
        queue.queueResearch({
          noteId,
          threadId: null,
          question: "主动通勤与心理健康的研究说明了什么，有哪些限制？",
          queries: [
            "active commuting mental health longitudinal study full text PMC",
          ],
        });
      await queue.pump();
      const task = store.task(taskId);
      if (task.status !== "done")
        throw new Error(task.error ?? "资料分析未完成");
      const research = store.snapshot().researches![0];
      report.readSources = research.sources.filter(
        (s) => s.status === "read",
      ).length;
      report.findings = research.report.findings.length;
      if (!report.findings) throw new Error("真实流程未取得可核对引用");
      report.passed = true;
    } catch (error) {
      report.error = safeAiError(error);
    } finally {
      store.close();
      writeFileSync(
        join(folder, "report.json"),
        JSON.stringify(report, null, 2),
      );
      console.log(JSON.stringify({ folder, ...report }));
      app.exit(report.passed ? 0 : 1);
    }
  })
  .catch((error) => {
    console.error(safeAiError(error));
    app.exit(1);
  });
