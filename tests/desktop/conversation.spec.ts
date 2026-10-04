import { _electron as electron, test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve, join } from "node:path";

test("note card: isolated multi-round replies and draft restart without thread assignment", async () => {
  const folder = resolve(".local", `conversation-${Date.now()}`);
  mkdirSync(folder, { recursive: true });
  const launch = () =>
    electron.launch({
      args: ["."],
      cwd: process.cwd(),
      env: { ...process.env, UKI_DATA_DIR: folder },
    });
  let app = await launch();
  const mock = async () =>
    app.evaluate(() => {
      (globalThis as any).conversationInputs = [];
      globalThis.fetch = async (_url, init) => {
        const body = JSON.parse(String(init?.body)),
          context = JSON.parse(body.input[0].content);
        (globalThis as any).conversationInputs.push(context);
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: body.stream ? `AI 回答：${context.raw}` : JSON.stringify({
                    threadId: null,
                    newThreadTitle: null,
                    title: context.origin ? "笔记追问" : "单条笔记",
                    synopsis: "",
                    reply: `AI 回答：${context.raw}`,
                  }),
                },
              },
            ],
            usage: { prompt_tokens: 100, completion_tokens: 50 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      };
    });
  try {
    await mock();
    let page = await app.firstWindow();
    await page.getByRole("heading", { name: "想法，从这里开始" }).waitFor();
    await page.evaluate(async () => {
      const { settings } = await window.uki.bootstrap();
      await window.uki.saveSettings(
        { ...settings, autoSync: false },
        "test-only-conversation",
      );
    });
    await page.getByLabel("写下想法").fill("这是一条独立笔记");
    await page.getByRole("button", { name: "保存想法", exact: true }).click();
    await expect(page.locator(".ai-reply").first()).toContainText(
      "AI 回答：这是一条独立笔记",
    );
    const rootId = (await page.evaluate(() => window.uki.view())).notes[0].id;
    let root = page.locator(`#note-${rootId}`);
    await root.getByRole("button", { name: "回复 AI", exact: true }).click();
    await root.getByLabel("回复这条笔记中的 AI").fill("这条笔记的回复草稿");
    await expect
      .poll(() =>
        page.evaluate(
          (id) =>
            window.uki
              .workspaceState("conversation:" + id)
              .then((s) => s.draft),
          rootId,
        ),
      )
      .toBe("这条笔记的回复草稿");
    await app.close();
    app = await launch();
    await mock();
    page = await app.firstWindow();
    root = page.locator(`#note-${rootId}`);
    await root.getByRole("button", { name: "回复 AI", exact: true }).click();
    await expect(root.getByLabel("回复这条笔记中的 AI")).toHaveValue(
      "这条笔记的回复草稿",
    );
    await root.getByLabel("回复这条笔记中的 AI").fill("第一轮补充");
    await root.getByRole("button", { name: "发送回复", exact: true }).click();
    await expect(root.locator(".discussion .ai-reply")).toHaveText([
      "AI 回答：第一轮补充",
    ]);
    await root.getByLabel("回复这条笔记中的 AI").fill("第二轮追问");
    await root.getByLabel("回复这条笔记中的 AI").press("Control+Enter");
    await expect(root.locator(".discussion .ai-reply")).toHaveText([
      "AI 回答：第一轮补充",
      "AI 回答：第二轮追问",
    ]);
    const inputs = await app.evaluate(
      () => (globalThis as any).conversationInputs,
    );
    expect(inputs[1].history.map((n: any) => n.aiReply)).toEqual([
      "AI 回答：这是一条独立笔记",
      "AI 回答：第一轮补充",
    ]);
    const detail = await page.evaluate((id) => window.uki.detail(id), rootId);
    expect(detail.note.raw).toBe("这是一条独立笔记");
    expect(detail.discussions).toHaveLength(2);
    expect(
      detail.discussions.every(
        (n) => n.parentNoteId === rootId && n.threadId === null,
      ),
    ).toBe(true);
    await page.screenshot({ path: join(folder, "conversation.png") });
  } finally {
    await app.close();
  }
});
