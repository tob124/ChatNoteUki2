// Explicit, bounded live validation against synthetic data. Credentials are
// read through Windows DPAPI; user notes and WebDAV are never loaded.
import { app } from "electron";
import { join, resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { Credentials } from "../electron/credentials";
import { Store } from "../electron/store";
import {
  AiQueue,
  DeepSeek,
  RequestError,
  safeAiError,
  type AiTransport,
} from "../electron/ai";
import { Materials } from "../electron/materials";
import { countTokens } from "../electron/token-count";
import { settingsSchema } from "../src/shared";
import { outputSchema } from "../electron/ai-schema";
app
  .whenReady()
  .then(async () => {
    const credentials = new Credentials(
      join(app.getPath("appData"), "ChatNoteUki", "credentials.json"),
    );
    const key = credentials.apiKey();
    if (!key) throw new Error("本机没有已保存的 DeepSeek key");
    const folder = resolve(".local", `live-quality-${Date.now()}`);
    mkdirSync(folder, { recursive: true });
    const store = new Store(join(folder, "thoughts.db")),
      network = new DeepSeek();
    const report = {
      model: "deepseek-flash",
      samples: [] as {
        kind: string;
        status: string;
        requests: number;
        ms: number;
        error: string | null;
      }[],
      requests: 0,
      input: 0,
      output: 0,
      unknownUsage: 0,
      startedAt: new Date().toISOString(),
      firstSuccessRate: 0,
      finalCompleteRate: 0,
      partialRate: 0,
      elapsedMs: 0,
      passed: false,
      error: "",
    };
    const started = Date.now();
    const transport: AiTransport = {
      complete: async (
        secret,
        model,
        system,
        context,
        maximum,
        signal,
        options,
      ) => {
        const estimate = countTokens(
          system +
            context +
            (options?.text ? "" : JSON.stringify(outputSchema(system))),
        );
        if (
          model !== "deepseek-flash" ||
          report.requests >= 80 ||
          report.input + estimate > 1_000_000 ||
          report.output + maximum > 150_000
        )
          throw new Error("本轮真实验证达到授权请求或 token 上限");
        report.requests++;
        let result;
        try {
          result = await network.complete(
            secret,
            model,
            system,
            context,
            maximum,
            signal,
            options,
          );
        } catch (e) {
          if (!(e instanceof RequestError && e.notBilled)) {
            report.unknownUsage++;
            report.input += estimate;
            report.output += maximum;
          }
          throw e;
        }
        if (result.usageKnown === false) {
          report.unknownUsage++;
          report.input += estimate;
          report.output += maximum;
        } else {
          report.input += result.input;
          report.output += result.output;
        }
        return result;
      },
    };
    const config = {
      apiKey: () => key,
      settings: () => settingsSchema.parse({}),
    };
    const ai = new AiQueue(store, config, () => {}, transport);
    const materials = new Materials(
      store,
      () => 32768,
      () => {},
      () => {},
      async () => {
        throw new Error("验证不使用 WebDAV");
      },
    );
    ai.materialWorker = (task, request) => materials.step(task, request);
    const record = async (
      kind: string,
      create: () => string,
      isTask = false,
    ) => {
      const before = report.requests,
        time = Date.now(),
        id = create();
      await ai.pump();
      const result = isTask ? store.task(id) : store.note(id);
      report.samples.push({
        kind,
        status: result.status,
        requests: report.requests - before,
        ms: Date.now() - time,
        error: result.error,
      });
      writeFileSync(
        join(folder, "report.json"),
        JSON.stringify(report, null, 2),
      );
      process.stdout.write(
        JSON.stringify({
          sample: report.samples.length,
          kind,
          status: result.status,
          requests: report.requests - before,
          ms: Date.now() - time,
        }) + "\n",
      );
    };
    try {
      const thread = store.thread({
        title: "城市出行与观察方法",
        description: "密度、公共交通与证据边界",
        parentId: null,
      });
      const notes = [
        "我以前认为密度越高越堵，现在觉得轨道交通可能改变这个关系，还需要查数据。",
        "今天同一路线步行比坐车快十分钟。这只是一次观察，不能代表平均情况。",
        "我想比较通勤时间，而不是简单比较人口密度。",
        "我记录了公交到站间隔：八分钟、十二分钟、七分钟。样本很小。",
        "我更重视老人和儿童能否方便地到达公园，但还不知道怎么衡量。",
        "我不认同把一次堵车经历当成规划失败的证明。",
        "我想把观察、猜测和有来源的事实分别记录，避免混为一谈。",
        "同样的平均通勤时间也可能隐藏不同人群的差异，这一点值得继续问。",
        "我目前无法判断改路还是增加公共交通更好，预算约束也需要考虑。",
        "我在考虑城市出行评估框架。" +
          "第一步记录具体观察及采样条件。第二步区分推测与证据。第三步比较不同解释，保留不确定性。".repeat(
            35,
          ),
      ];
      const ids: string[] = [];
      for (const raw of notes)
        await record("note", () => {
          const id = store.capture({ raw, threadId: thread });
          ids.push(id);
          return id;
        });
      for (let i = 0; i < 5; i++)
        await record("discussion", () =>
          store.capture({
            raw: [
              "请帮我找出这个观察还缺少什么条件。",
              "我补充一下，这是周日早上，是否影响理解？",
              "我没有同意前面的结论，请保留不确定性。",
              "请提出两个可以继续记录的问题。",
              "如果改变采样时段，应该注意哪些偏差？",
            ][i],
            threadId: thread,
            mode: "discussion",
            parentNoteId: ids[i],
          }),
        );
      for (let i = 0; i < 6; i++)
        await record(
          "recap",
          () => ai.queueAnalysis("recap", thread, "deepseek-flash"),
          true,
        );
      for (let i = 0; i < 5; i++)
        await record(
          "cognition",
          () => ai.queueAnalysis("cognition", thread, "deepseek-flash"),
          true,
        );
      for (let i = 0; i < 5; i++)
        await record(
          "organize",
          () =>
            store.addTask(
              "organize",
              null,
              "deepseek-flash",
              ids.slice(i, i + 3),
            ),
          true,
        );
      for (let i = 0; i < 4; i++)
        await record(
          "material",
          () => {
            const id = randomUUID(),
              text = `参考资料 ${i + 1}：这是合成的公共交通调查。样本为两个虚构城市；出行时间受到路线、换乘和采样时段影响，不能据此断言人口密度决定拥堵。`,
              bytes = Buffer.from(text),
              sha256 = createHash("sha256").update(bytes).digest("hex");
            store.append("material.updated", {
              id,
              value: {
                id,
                name: `合成资料-${i + 1}.txt`,
                format: "txt",
                bytes: bytes.length,
                sha256,
                chunks: [{ sha256, bytes: bytes.length }],
                noteId: ids[i],
                createdAt: new Date().toISOString(),
                revision: 0,
                status: "pending",
                error: null,
                coverage: "已提取全部合成段落",
                segments: [{ id: 1, page: null, paragraph: 1, text }],
                summary: "",
                summaries: [],
              },
            });
            return materials.queue(id);
          },
          true,
        );
    } catch (e) {
      report.error = safeAiError(e);
    } finally {
      ai.stop();
      store.close();
    }
    const n = report.samples.length;
    report.firstSuccessRate = n
      ? report.samples.filter((s) => s.status === "done" && s.requests === 1)
          .length / n
      : 0;
    report.finalCompleteRate = n
      ? report.samples.filter((s) => s.status === "done").length / n
      : 0;
    report.partialRate = n
      ? report.samples.filter((s) => s.status === "partial").length / n
      : 0;
    report.elapsedMs = Date.now() - started;
    report.passed =
      n >= 35 &&
      report.finalCompleteRate >= 0.95 &&
      report.requests <= 80 &&
      report.input <= 1_000_000 &&
      report.output <= 150_000;
    writeFileSync(join(folder, "report.json"), JSON.stringify(report, null, 2));
    process.stdout.write(
      JSON.stringify({ ...report, samples: undefined, folder }) + "\n",
    );
    app.exit(report.passed ? 0 : 1);
  })
  .catch((e) => {
    process.stderr.write(safeAiError(e) + "\n");
    app.exit(1);
  });
