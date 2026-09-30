import { Store } from "../electron/store";
import { randomUUID } from "node:crypto";
const s = new Store(process.argv[2]);
const root = s.thread({
  title: "升级验收旧问题",
  description: "历史范围",
  parentId: null,
});
const note = s.createNote({
  raw: "升级验收原话，保持历史版本。",
  threadId: root,
});
const {
  revision,
  legacy,
  parentRevision,
  parentNoteId,
  assignmentRevision,
  edition,
  reentered,
  ...old
} = note;
s.append("note.added", old);
s.append("note.completed", {
  id: note.id,
  threadId: root,
  result: {
    threadId: root,
    newThreadTitle: null,
    title: "升级前标题",
    synopsis: "升级前已有摘要",
    reply: "升级前已有回应",
  },
});
const p = randomUUID(),
  after = {
    viewpoint: "升级前已确认认知",
    reasons: [],
    uncertainties: [],
    questions: [],
    decisions: [],
  };
s.append("proposal.added", {
  id: p,
  threadId: root,
  baseVersion: 0,
  before: s.cognition(root),
  after,
  reason: "合成验收",
  evidenceIds: [note.id],
  createdAt: new Date().toISOString(),
  status: "pending",
});
s.append("proposal.resolved", { id: p, decision: "accept" });
s.append("note.corrected", { id: note.id, raw: "升级验收最新更正。" });
s.capture({
  raw: "旧对话不导入",
  mode: "discussion",
  threadId: root,
  parentNoteId: note.id,
});
s.capture({ raw: "相同原文" });
s.capture({ raw: "相同原文" });
s.close();
