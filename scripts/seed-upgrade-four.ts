import { Store } from "../electron/store";
import { randomUUID } from "node:crypto";
const s = new Store(process.argv[2]);
const thread = s.thread({
    title: "升级验收问题",
    description: "范围说明",
    parentId: null,
  }),
  id = s.capture({ raw: "初始正文", threadId: thread });
s.append("note.completed", {
  id,
  threadId: thread,
  result: {
    threadId: thread,
    newThreadTitle: null,
    title: "AI标题",
    synopsis: "已有摘要",
    reply: "已有回应",
  },
});
s.append("note.corrected", { id, raw: "人工更正的最新正文" });
s.append("note.titled", { id, title: "人工标题" });
const proposal = randomUUID(),
  after = {
    viewpoint: "人工确认的认知",
    reasons: ["原始理由"],
    uncertainties: [],
    questions: [],
    decisions: [],
  };
s.append("proposal.added", {
  id: proposal,
  threadId: thread,
  baseVersion: 0,
  before: s.cognition(thread),
  after,
  reason: "合成测试",
  evidenceIds: [id],
  createdAt: new Date().toISOString(),
  status: "pending",
});
s.append("proposal.resolved", { id: proposal, decision: "accept" });
s.workspaceState("all", {
  draft: "升级保留草稿",
  mode: "note",
  parentNoteId: null,
  openIds: [id],
});
s.close();
