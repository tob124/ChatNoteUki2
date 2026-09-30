// Explicit opt-in Flash check: synthetic notes only, no DAV, at most five calls.
import { app } from "electron";
import { join, resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { Credentials } from "../electron/credentials";
import { Store } from "../electron/store";
import {
  AiQueue,
  DeepSeek,
  safeAiError,
  type AiTransport,
} from "../electron/ai";
import { settingsSchema } from "../src/shared";

app
  .whenReady()
  .then(async () => {
    const credentials = new Credentials(
      process.env.UKI_LIVE_CREDENTIALS_PATH ??
        join(app.getPath("appData"), "ChatNoteUki", "credentials.json"),
    );
    const key = credentials.apiKey();
    if (!key) throw new Error("本机指定资料目录没有已保存的 DeepSeek key");
    const folder = resolve(".local", `live-feedback-${Date.now()}`);
    mkdirSync(folder, { recursive: true });
    const store = new Store(join(folder, "thoughts.db"));
    const network = new DeepSeek();
    const report = {
      model: "deepseek-flash",
      calls: 0,
      input: 0,
      output: 0,
      checks: [] as unknown[],
      passed: false,
      error: "",
    };
    const transport: AiTransport = {
      complete: async (secret, model, system, context, maxOutput) => {
        if (
          model !== "deepseek-flash" ||
          report.calls >= 5 ||
          report.input + Buffer.byteLength(system + context) > 20000 ||
          report.output + maxOutput > 4000
        )
          throw new Error("真实验证预算已到上限，不继续请求");
        report.calls++;
        const r = await network.complete(
          secret,
          model,
          system,
          context,
          maxOutput,
        );
        report.input += r.input;
        report.output += r.output;
        let shape: unknown = "invalid JSON";
        try {
          shape = Object.fromEntries(
            Object.entries(JSON.parse(r.content)).map(([k, v]) => [
              k,
              {
                type:
                  v === null ? "null" : Array.isArray(v) ? "array" : typeof v,
                length:
                  typeof v === "string" || Array.isArray(v)
                    ? v.length
                    : undefined,
              },
            ]),
          );
        } catch {}
        report.checks.push({
          kind: system.includes('"expressed"')
            ? "recap"
            : system.includes("suggestions 数组")
              ? "organize"
              : "note",
          shape,
        });
        return r;
      },
    };
    const ai = new AiQueue(
      store,
      {
        apiKey: () => key,
        settings: () =>
          settingsSchema.parse({
            dailyInputLimit: 20000,
            dailyOutputLimit: 4000,
          }),
      },
      () => {},
      transport,
    );
    try {
      const thread = store.thread({
        title: "城市密度与出行",
        description: "公共交通、通勤距离与城市密度的关系",
        parentId: null,
      });
      const first = store.capture({
        raw: "我以前以为高密度必然导致拥堵，现在觉得公共交通也许比密度更重要。还需要证据。",
      });
      await ai.pump();
      if (store.note(first).status !== "done")
        throw new Error(store.note(first).error ?? "短笔记整理失败");
      if (!process.argv.includes("--note-only")) {
        const second = store.capture({
          raw: "我想比较两座人口密度接近的城市，先看居民平均通勤距离，再看轨道交通覆盖程度和换乘次数。我目前只有个别亲身体验，不能据此得出一般结论。下次记录时，希望分别标明观察、猜测和已经查到的事实，避免把堵车感受直接当成城市规划是否成功的证据。也要考虑出行方式、工作地点与居住地点的影响。",
          threadId: thread,
        });
        await ai.pump();
        if (store.note(second).status !== "done")
          throw new Error(store.note(second).error ?? "长笔记整理失败");
        if (store.note(first).threadId !== thread)
          store.append("note.moved", { id: first, threadId: thread });
        const recap = ai.queueAnalysis("recap", thread, "deepseek-flash");
        await ai.pump();
        if (store.task(recap).status !== "done")
          throw new Error(store.task(recap).error ?? "线程回顾失败");
        const organize = store.addTask("organize", null, "deepseek-flash", [
          first,
          second,
        ]);
        await ai.pump();
        if (store.task(organize).status !== "done")
          throw new Error(store.task(organize).error ?? "结构整理失败");
        report.passed =
          store.workspace({ workspace: "review" }).items.length === 1;
        if (!report.passed) throw new Error("回顾没有进入回顾列表");
      } else report.passed = true;
    } catch (e) {
      report.error = safeAiError(e);
    } finally {
      ai.stop();
      store.close();
    }
    writeFileSync(join(folder, "report.json"), JSON.stringify(report, null, 2));
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    app.exit(report.passed ? 0 : 1);
  })
  .catch((e) => {
    process.stderr.write(safeAiError(e) + "\n");
    app.exit(1);
  });
