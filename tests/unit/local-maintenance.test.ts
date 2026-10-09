import { it, expect } from "vitest";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../electron/store";

it("permanent deletion scrubs ordered reentry ancestors and automatic backups without deleting other notes", () => {
  const root = mkdtempSync(join(tmpdir(), "uki-local-purge-")),
    path = join(root, "thoughts.db");
  const store = new Store(path);
  const old = store.createNote({ raw: "原始秘密甲" }),
    { edition, ...legacy } = old;
  store.append("note.added", legacy);
  store.append("note.corrected", { id: old.id, raw: "最新秘密甲" });
  store.capture({
    raw: "旧追问秘密",
    mode: "discussion",
    parentNoteId: old.id,
  });
  store.capture({ raw: "保留另一条笔记" });
  store.reimportRawNotes();
  const first = store.snapshot().notes[0];
  store.append("note.trashed", { id: first.id });
  store.append("note.purged", { id: first.id });
  expect(JSON.stringify(store.eventsAfter())).not.toMatch(
    /原始秘密甲|最新秘密甲|旧追问秘密/,
  );
  store.maintainLocalCopies();
  expect(store.getMeta("purgeLocalPending")).toBeNull();
  store.close();
  for (const name of readdirSync(join(root, "backups"))) {
    const file = join(root, "backups", name);
    expect(readFileSync(file).includes(Buffer.from("原始秘密甲"))).toBe(false);
    const backup = new Store(file, false);
    backup.reimportRawNotes();
    expect(
      backup
        .workspace({ workspace: "all" })
        .items.map((i) => (i.value as any).raw),
    ).toEqual(["保留另一条笔记"]);
    backup.close();
  }
  const restored = new Store(path);
  restored.maintainLocalCopies();
  expect(restored.workspace({ workspace: "all" }).total).toBe(1);
  restored.close();
});

it("backs up before a projection upgrade and leaves manual fields, drafts and cognition intact", () => {
  const path = join(
    mkdtempSync(join(tmpdir(), "uki-upgrade-four-")),
    "thoughts.db",
  );
  let s = new Store(path);
  const id = s.capture({ raw: "升级保留正文" });
  s.append("note.titled", { id, title: "手动标题" });
  s.workspaceState("all", {
    draft: "未提交的草稿",
    mode: "note",
    parentNoteId: null,
    openIds: [],
  });
  s.setMeta("projectionVersion", "2.8");
  s.close();
  s = new Store(path);
  expect(s.getMeta("backup0.4")).toBeTruthy();
  expect(s.note(id).title).toBe("手动标题");
  expect(s.workspaceState("all").draft).toBe("未提交的草稿");
  expect(s.getMeta("projectionVersion")).toBe("2.9");
  const seq = s.latestSeq();
  s.close();
  s = new Store(path);
  expect(s.latestSeq()).toBe(seq);
  s.close();
});

it("cognition history previews stay small, version loading and restoration preserve the full text and base protection", () => {
  const s = new Store(":memory:");
  const id = s.thread({ title: "测试问题", description: "", parentId: null }),
    content = {
      viewpoint: "长认知".repeat(1000),
      reasons: [],
      uncertainties: [],
      questions: [],
      decisions: [],
    };
  s.append("cognition.edited", { threadId: id, baseVersion: 0, content });
  expect(
    s.resources(id).cognitionHistory[0].viewpoint.length,
  ).toBeLessThanOrEqual(160);
  expect(s.cognitionVersion(id, 1).viewpoint).toBe(content.viewpoint);
  s.append("cognition.edited", {
    threadId: id,
    baseVersion: 1,
    content: { ...content, viewpoint: "新认知" },
  });
  expect(() =>
    s.append("cognition.edited", {
      threadId: id,
      baseVersion: 1,
      content: s.cognitionVersion(id, 1),
    }),
  ).toThrow();
  s.append("cognition.edited", {
    threadId: id,
    baseVersion: 2,
    content: s.cognitionVersion(id, 1),
  });
  expect(s.cognition(id).version).toBe(3);
  expect(s.cognition(id).viewpoint).toBe(content.viewpoint);
  s.close();
});
